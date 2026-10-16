use std::{
    collections::{HashMap, HashSet},
    future::Future,
    io::{self, Cursor},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    pin::Pin,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Weak,
    },
    task::{Context, Poll},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Router,
};
use axum_server::{
    accept::Accept,
    tls_rustls::{RustlsAcceptor, RustlsConfig},
};
use futures_util::StreamExt;
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, UnixTime},
    server::danger::{ClientCertVerified, ClientCertVerifier},
    DigitallySignedStruct, SignatureScheme,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::{
    fs,
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf},
    sync::{oneshot, watch, Mutex, OwnedSemaphorePermit, Semaphore},
    task::JoinHandle,
};

use crate::{
    error::ApiError,
    file_tools::FileTools,
    shelf::{SharedFile, Shelf},
};

const PORT: u16 = 53317;
const GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 167);
const PREFIX: &str = "/api/localsend/v2/";
const MAX_FILES: usize = 20;
const MAX_JSON: usize = 65536;
const MAX_OFFER_JSON: usize = 1024 * 1024;
const MAX_PEERS: usize = 64;
const PEER_TTL: u64 = 90000;
const FIRST_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECTION_IDLE_TIMEOUT: Duration = Duration::from_secs(90);

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn opaque(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn clean(value: Option<&str>, limit: usize) -> String {
    value
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect::<String>()
        .trim()
        .to_string()
}

fn fingerprint(value: &str) -> Option<String> {
    if value.len() > 100 {
        return None;
    }
    let normalized = value
        .chars()
        .filter(|c| !matches!(c, ':' | ' ' | '-'))
        .collect::<String>()
        .to_ascii_lowercase();
    (normalized.len() == 64 && normalized.bytes().all(|b| b.is_ascii_hexdigit()))
        .then_some(normalized)
}

fn is_lan(address: IpAddr, allow_loopback: bool) -> bool {
    let v4 = match address {
        IpAddr::V4(v4) => Some(v4),
        IpAddr::V6(v6) => v6.to_ipv4_mapped(),
    };
    v4.is_some_and(|ip| ip.is_private() || ip.is_link_local() || allow_loopback && ip.is_loopback())
}

fn manual_address(value: &str, allow_loopback: bool) -> Option<SocketAddr> {
    if value.len() > 64 || value != value.trim() {
        return None;
    }
    let address = value.parse::<SocketAddr>().ok().or_else(|| {
        value
            .parse::<IpAddr>()
            .ok()
            .map(|ip| SocketAddr::new(ip, PORT))
    })?;
    (address.port() != 0 && is_lan(address.ip(), allow_loopback)).then_some(address)
}

fn safe_name(name: &str) -> bool {
    if name.is_empty()
        || name.len() > 255
        || name != name.trim()
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return false;
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    !matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        && !(stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

#[derive(Clone, Serialize, Deserialize)]
struct Identity {
    cert: String,
    key: String,
    fingerprint: String,
}

impl Identity {
    async fn load(directory: &Path) -> Result<Self, ApiError> {
        fs::create_dir_all(directory).await?;
        verify_directory(directory).await?;
        let path = directory.join("localsend-identity.json");
        let identity = match fs::symlink_metadata(&path).await {
            Ok(metadata) => {
                if !metadata.is_file()
                    || metadata.file_type().is_symlink()
                    || metadata.len() > 65536
                {
                    return Err(ApiError::new(503, "L’identité LocalSend est indisponible."));
                }
                let mut value: Self = serde_json::from_slice(&fs::read(&path).await?)
                    .map_err(|_| ApiError::new(503, "L’identité LocalSend est invalide."))?;
                let certificate = rustls_pemfile::certs(&mut Cursor::new(value.cert.as_bytes()))
                    .next()
                    .transpose()
                    .map_err(|_| ApiError::new(503, "Certificat LocalSend invalide."))?
                    .ok_or_else(|| ApiError::new(503, "Certificat LocalSend manquant."))?;
                value.fingerprint = digest(certificate.as_ref());
                value
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let generated = rcgen::generate_simple_self_signed(vec!["notchy.local".into()])
                    .map_err(|_| ApiError::new(503, "Impossible de créer l’identité LocalSend."))?;
                let value = Self {
                    cert: generated.cert.pem(),
                    key: generated.signing_key.serialize_pem(),
                    fingerprint: digest(generated.cert.der().as_ref()),
                };
                let temporary = directory.join(format!(".identity-{}.tmp", token()));
                let mut file = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temporary)
                    .await?;
                file.write_all(
                    &serde_json::to_vec(&value)
                        .map_err(|_| ApiError::new(503, "Identité invalide."))?,
                )
                .await?;
                file.sync_all().await?;
                drop(file);
                if let Err(error) = fs::rename(&temporary, &path).await {
                    let _ = fs::remove_file(&temporary).await;
                    return Err(error.into());
                }
                value
            }
            Err(error) => return Err(error.into()),
        };
        // This verifies that the existing certificate and private key still form one identity.
        let _ = identity.server_config().await?;
        Ok(identity)
    }

    async fn server_config(&self) -> Result<RustlsConfig, ApiError> {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let certs = rustls_pemfile::certs(&mut Cursor::new(self.cert.as_bytes()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ApiError::new(503, "Certificat LocalSend invalide."))?;
        let key = rustls_pemfile::private_key(&mut Cursor::new(self.key.as_bytes()))
            .map_err(|_| ApiError::new(503, "Clé TLS invalide."))?
            .ok_or_else(|| ApiError::new(503, "Clé TLS manquante."))?;
        let config = rustls::ServerConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()
            .map_err(|_| ApiError::new(503, "TLS indisponible."))?
            .with_client_cert_verifier(Arc::new(OptionalClientCertificate { provider }))
            .with_single_cert(certs, key)
            .map_err(|_| ApiError::new(503, "L’identité TLS LocalSend est invalide."))?;
        Ok(RustlsConfig::from_config(Arc::new(config)))
    }
}

async fn verify_directory(directory: &Path) -> Result<(), ApiError> {
    let metadata = fs::symlink_metadata(directory).await?;
    let canonical = fs::canonicalize(directory).await?;
    let expected = directory
        .to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .to_ascii_lowercase();
    let actual = canonical
        .to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .to_ascii_lowercase();
    if !directory.is_absolute()
        || !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || expected != actual
    {
        return Err(ApiError::new(
            503,
            "Le stockage LocalSend est indisponible.",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug)]
struct Peer {
    id: String,
    alias: String,
    device_type: String,
    device_model: Option<String>,
    protocol: String,
    fingerprint: String,
    address: IpAddr,
    port: u16,
    seen_at: u64,
}

impl Peer {
    fn parse(value: &Value, address: IpAddr, allow_loopback: bool, incoming: bool) -> Option<Self> {
        if !is_lan(address, allow_loopback) || !value.is_object() {
            return None;
        }
        let version = value.get("version")?.as_str()?;
        let minor = version.strip_prefix("2.")?;
        if minor.is_empty() || minor.len() > 2 || !minor.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let protocol = value
            .get("protocol")
            .and_then(Value::as_str)
            .unwrap_or(if incoming { "https" } else { "" });
        let fp = if protocol == "https" {
            fingerprint(
                value
                    .get("fingerprint")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
            .unwrap_or_default()
        } else if protocol == "http" {
            clean(value.get("fingerprint").and_then(Value::as_str), 128)
        } else {
            return None;
        };
        if fp.is_empty() && !(incoming && protocol == "https") {
            return None;
        }
        let port = value
            .get("port")
            .and_then(Value::as_u64)
            .unwrap_or(if incoming { PORT as u64 } else { 0 });
        if port == 0 || port > 65535 {
            return None;
        }
        let alias = clean(value.get("alias").and_then(Value::as_str), 60);
        let model = clean(value.get("deviceModel").and_then(Value::as_str), 80);
        let kind = value
            .get("deviceType")
            .and_then(Value::as_str)
            .unwrap_or("desktop");
        Some(Self {
            id: token(),
            alias: if alias.is_empty() {
                "Appareil LocalSend".into()
            } else {
                alias
            },
            device_type: if matches!(kind, "mobile" | "desktop" | "web" | "headless" | "server") {
                kind.into()
            } else {
                "desktop".into()
            },
            device_model: (!model.is_empty()).then_some(model),
            protocol: protocol.into(),
            fingerprint: fp,
            address,
            port: port as u16,
            seen_at: now(),
        })
    }

    fn public(&self) -> Value {
        let identity = digest(format!("{}:{}", self.protocol, self.fingerprint).as_bytes());
        json!({"id":self.id,"identity":identity,"alias":self.alias,"deviceType":self.device_type,"deviceModel":self.device_model,"secure":self.protocol == "https"})
    }
    fn url(&self, action: &str) -> String {
        format!(
            "{}://{}{}{}",
            self.protocol, SocketAddr::new(self.address, self.port), PREFIX, action
        )
    }
}

#[derive(Debug)]
struct PinnedCertificate {
    fingerprint: Option<String>,
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl ServerCertVerifier for PinnedCertificate {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if self
            .fingerprint
            .as_ref()
            .is_some_and(|fingerprint| digest(end_entity.as_ref()) != *fingerprint)
        {
            return Err(rustls::Error::General(
                "LocalSend certificate identity changed".into(),
            ));
        }
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[derive(Debug)]
struct OptionalClientCertificate {
    provider: Arc<rustls::crypto::CryptoProvider>,
}
impl ClientCertVerifier for OptionalClientCertificate {
    fn client_auth_mandatory(&self) -> bool {
        false
    }
    fn root_hint_subjects(&self) -> &[rustls::DistinguishedName] {
        &[]
    }
    fn verify_client_cert(
        &self,
        certificate: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: UnixTime,
    ) -> Result<ClientCertVerified, rustls::Error> {
        if certificate.as_ref().is_empty() || certificate.as_ref().len() > 65536 {
            return Err(rustls::Error::General(
                "Invalid LocalSend client certificate".into(),
            ));
        }
        Ok(ClientCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            certificate,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            certificate,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[derive(Clone)]
struct ClientFingerprint(String);
#[derive(Clone)]
struct ConnectionService<S> {
    inner: S,
    fingerprint: Option<ClientFingerprint>,
    received_request: Arc<AtomicBool>,
}
impl<B, S> tower::Service<axum::http::Request<B>> for ConnectionService<S>
where
    S: tower::Service<axum::http::Request<B>>,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = S::Future;
    fn poll_ready(&mut self, context: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(context)
    }
    fn call(&mut self, mut request: axum::http::Request<B>) -> Self::Future {
        self.received_request.store(true, Ordering::Release);
        if let Some(fingerprint) = self.fingerprint.clone() {
            request.extensions_mut().insert(fingerprint);
        }
        self.inner.call(request)
    }
}

struct ConnectionStream<S> {
    inner: S,
    _permit: OwnedSemaphorePermit,
    first_request: Option<Arc<AtomicBool>>,
    deadline: Pin<Box<tokio::time::Sleep>>,
}
impl<S> ConnectionStream<S> {
    fn new(inner: S, permit: OwnedSemaphorePermit, received_request: Arc<AtomicBool>) -> Self {
        Self {
            inner,
            _permit: permit,
            first_request: Some(received_request),
            deadline: Box::pin(tokio::time::sleep(FIRST_REQUEST_TIMEOUT)),
        }
    }

    fn poll_deadline(&mut self, context: &mut Context<'_>) -> io::Result<()> {
        if self
            .first_request
            .as_ref()
            .is_some_and(|received| received.load(Ordering::Acquire))
        {
            self.first_request = None;
            self.activity();
        }
        if self.deadline.as_mut().poll(context).is_ready() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "LocalSend connection timed out",
            ));
        }
        Ok(())
    }

    fn activity(&mut self) {
        // Only a complete first request ends the absolute protocol/header deadline.
        if self.first_request.is_none() {
            self.deadline
                .as_mut()
                .reset(tokio::time::Instant::now() + CONNECTION_IDLE_TIMEOUT);
        }
    }
}
impl<S: AsyncRead + Unpin> AsyncRead for ConnectionStream<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if let Err(error) = self.poll_deadline(context) {
            return Poll::Ready(Err(error));
        }
        let filled = buffer.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(context, buffer);
        if matches!(result, Poll::Ready(Ok(()))) && buffer.filled().len() > filled {
            self.activity();
        }
        result
    }
}
impl<S: AsyncWrite + Unpin> AsyncWrite for ConnectionStream<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        if let Err(error) = self.poll_deadline(context) {
            return Poll::Ready(Err(error));
        }
        let result = Pin::new(&mut self.inner).poll_write(context, bytes);
        if matches!(result, Poll::Ready(Ok(length)) if length > 0) {
            self.activity();
        }
        result
    }
    fn poll_flush(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        if let Err(error) = self.poll_deadline(context) {
            return Poll::Ready(Err(error));
        }
        Pin::new(&mut self.inner).poll_flush(context)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        if let Err(error) = self.poll_deadline(context) {
            return Poll::Ready(Err(error));
        }
        Pin::new(&mut self.inner).poll_shutdown(context)
    }
}

#[derive(Clone)]
struct LocalAcceptor {
    inner: RustlsAcceptor,
    connections: Arc<Semaphore>,
    allow_loopback: bool,
}
impl<S: Send + 'static> Accept<tokio::net::TcpStream, S> for LocalAcceptor {
    type Stream = ConnectionStream<tokio_rustls::server::TlsStream<tokio::net::TcpStream>>;
    type Service = ConnectionService<S>;
    type Future = Pin<Box<dyn Future<Output = io::Result<(Self::Stream, Self::Service)>> + Send>>;
    fn accept(&self, stream: tokio::net::TcpStream, service: S) -> Self::Future {
        let permitted = stream
            .peer_addr()
            .map(|address| is_lan(address.ip(), self.allow_loopback))
            .unwrap_or(false);
        let permit = if permitted {
            self.connections.clone().try_acquire_owned().ok()
        } else {
            None
        };
        let future = self.inner.accept(stream, service);
        Box::pin(async move {
            let permit = permit.ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "LocalSend connection refused",
                )
            })?;
            let (stream, service) = future.await?;
            let fingerprint = stream
                .get_ref()
                .1
                .peer_certificates()
                .and_then(|certs| certs.first())
                .map(|certificate| ClientFingerprint(digest(certificate.as_ref())));
            let received_request = Arc::new(AtomicBool::new(false));
            Ok((
                ConnectionStream::new(stream, permit, received_request.clone()),
                ConnectionService {
                    inner: service,
                    fingerprint,
                    received_request,
                },
            ))
        })
    }
}

#[derive(Clone)]
struct IncomingFile {
    id: String,
    name: String,
    size: u64,
    checksum: Option<String>,
    token: String,
    status: String,
}

fn parse_offer(value: &Value) -> Result<Vec<IncomingFile>, ApiError> {
    let entries = value
        .get("files")
        .and_then(Value::as_object)
        .ok_or_else(|| ApiError::new(400, "Les informations des fichiers sont invalides."))?;
    if entries.is_empty() || entries.len() > MAX_FILES {
        return Err(ApiError::new(
            400,
            "Un lot LocalSend peut contenir de 1 à 20 fichiers.",
        ));
    }
    let mut total_bytes = 0u64;
    entries
        .iter()
        .map(|(id, file)| {
            let name = file
                .get("fileName")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let size = file.get("size").and_then(Value::as_u64);
            if id.is_empty()
                || id.len() > 128
                || id.chars().any(char::is_control)
                || file.get("id").and_then(Value::as_str) != Some(id.as_str())
                || !safe_name(name)
                || size.is_none()
            {
                return Err(ApiError::new(
                    400,
                    "La taille ou le nom Windows d’un fichier est invalide.",
                ));
            }
            let checksum = match file.get("sha256") {
                None | Some(Value::Null) => None,
                Some(Value::String(value))
                    if value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()) =>
                {
                    Some(value.to_ascii_lowercase())
                }
                _ => return Err(ApiError::new(400, "La somme de contrôle est invalide.")),
            };
            total_bytes = total_bytes
                .checked_add(size.unwrap())
                .ok_or_else(|| ApiError::new(400, "La taille totale du lot est invalide."))?;
            Ok(IncomingFile {
                id: id.clone(),
                name: name.into(),
                size: size.unwrap_or_default(),
                checksum,
                token: token(),
                status: "pending".into(),
            })
        })
        .collect()
}

struct Offer {
    id: String,
    session_id: String,
    address: IpAddr,
    alias: String,
    created_at: u64,
    files: Mutex<Vec<IncomingFile>>,
    accepted: AtomicBool,
    cancelled: AtomicBool,
    cancel: watch::Sender<bool>,
    response: Mutex<Option<oneshot::Sender<(u16, Value)>>>,
    total_bytes: u64,
    transferred: AtomicU64,
    activity: watch::Sender<()>,
}

struct Outgoing {
    id: String,
    peer: Peer,
    cancel: watch::Sender<bool>,
    session_id: Mutex<Option<String>>,
    activity: watch::Sender<()>,
}

struct ServiceState {
    status: String,
    available: bool,
    error: Option<String>,
    peers: HashMap<String, Peer>,
    offer: Option<Arc<Offer>>,
    outgoing: Option<Arc<Outgoing>>,
    transfer: Option<Value>,
    rates: HashMap<IpAddr, (u64, u32)>,
    replies: HashMap<IpAddr, u64>,
}

struct Network {
    handle: axum_server::Handle,
    stop: watch::Sender<bool>,
    tasks: Vec<JoinHandle<()>>,
    socket: Option<Arc<tokio::net::UdpSocket>>,
}

#[derive(Clone)]
struct Options {
    port: u16,
    discovery_port: u16,
    allow_loopback: bool,
    multicast: bool,
    consent: Duration,
    session: Duration,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            port: PORT,
            discovery_port: PORT,
            allow_loopback: false,
            multicast: true,
            consent: Duration::from_secs(60),
            session: Duration::from_secs(90),
        }
    }
}

pub struct LocalSend {
    directory: PathBuf,
    shelf: Arc<Shelf>,
    identity: Identity,
    state: Mutex<ServiceState>,
    network: Mutex<Option<Network>>,
    lifecycle: Mutex<()>,
    receive_queue: Mutex<()>,
    disposed: AtomicBool,
    port: AtomicU64,
    options: Options,
    requests: Arc<Semaphore>,
}

impl LocalSend {
    pub async fn new(directory: PathBuf, shelf: Arc<Shelf>) -> Result<Self, ApiError> {
        Self::with_options(directory, shelf, Options::default()).await
    }

    async fn with_options(
        directory: PathBuf,
        shelf: Arc<Shelf>,
        options: Options,
    ) -> Result<Self, ApiError> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let identity = Identity::load(&directory).await?;
        Ok(Self {
            directory,
            shelf,
            identity,
            state: Mutex::new(ServiceState {
                status: "off".into(),
                available: false,
                error: None,
                peers: HashMap::new(),
                offer: None,
                outgoing: None,
                transfer: None,
                rates: HashMap::new(),
                replies: HashMap::new(),
            }),
            network: Mutex::new(None),
            lifecycle: Mutex::new(()),
            receive_queue: Mutex::new(()),
            disposed: AtomicBool::new(false),
            port: AtomicU64::new(options.port as u64),
            options,
            requests: Arc::new(Semaphore::new(32)),
        })
    }

    fn information(&self) -> Value {
        json!({"alias":"Notchy nouvelle","version":"2.2","deviceModel":"Windows","deviceType":"desktop","fingerprint":self.identity.fingerprint,"port":self.port.load(Ordering::Relaxed),"protocol":"https","download":false})
    }

    pub async fn snapshot(&self) -> Value {
        let state = self.state.lock().await;
        let incoming = if let Some(offer) = state
            .offer
            .as_ref()
            .filter(|offer| !offer.accepted.load(Ordering::Acquire))
        {
            let files = offer.files.lock().await;
            json!({"id":offer.id,"alias":offer.alias,"files":files.iter().map(|file| json!({"name":file.name,"size":file.size})).collect::<Vec<_>>(),"totalBytes":offer.total_bytes,"createdAt":offer.created_at,"status":"awaiting-consent"})
        } else {
            Value::Null
        };
        json!({"status":state.status,"available":state.available,"error":state.error,"peers":state.peers.values().filter(|p| now().saturating_sub(p.seen_at) < PEER_TTL).map(Peer::public).collect::<Vec<_>>(),"transfer":state.transfer,"incoming":incoming})
    }

    async fn snapshot_error(&self, message: &str) -> Value {
        let mut value = self.snapshot().await;
        value["error"] = message.into();
        value
    }

    pub async fn command(
        self: &Arc<Self>,
        value: Value,
        tools: &Arc<FileTools>,
    ) -> Result<Value, ApiError> {
        if !valid_command(&value) {
            return Err(ApiError::new(
                400,
                if value["command"] == "connect" {
                    "Adresse IP locale ou port invalide."
                } else {
                    "Commande LocalSend invalide."
                },
            ));
        }
        if self.disposed.load(Ordering::Acquire) {
            return Ok(self.snapshot_error("LocalSend est fermé.").await);
        }
        match value["command"].as_str().unwrap_or_default() {
            "discover" => {
                self.start().await?;
                self.announce(true).await;
                Ok(self.snapshot().await)
            }
            "connect" => self.connect(value["address"].as_str().unwrap()).await,
            "stop" => {
                self.stop().await;
                Ok(self.snapshot().await)
            }
            "accept" => self.accept(value["id"].as_str().unwrap_or_default()).await,
            "reject" => self.reject(value["id"].as_str().unwrap_or_default()).await,
            "cancel" => self.cancel(value["id"].as_str().unwrap_or_default()).await,
            "share" => {
                let ids = value["ids"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap().to_string())
                    .collect::<Vec<_>>();
                let entries = if value["source"] == "files" {
                    tools.share_entries(&ids).await?
                } else {
                    self.shelf.share_entries(&ids).await?
                };
                self.send(value["peerId"].as_str().unwrap(), entries).await
            }
            _ => unreachable!(),
        }
    }

    async fn remember(&self, value: &Value, address: IpAddr) -> Option<Peer> {
        let peer = Peer::parse(value, address, self.options.allow_loopback, false)?;
        self.remember_peer(peer).await
    }

    async fn remember_peer(&self, mut peer: Peer) -> Option<Peer> {
        if peer.fingerprint == self.identity.fingerprint {
            return None;
        }
        let key = format!("{}:{}", peer.protocol, peer.fingerprint);
        let mut state = self.state.lock().await;
        if !state.available {
            return None;
        }
        if let Some(known) = state.peers.get(&key) {
            peer.id = known.id.clone();
        } else if state.peers.len() >= MAX_PEERS {
            return None;
        }
        state.peers.insert(key, peer.clone());
        Some(peer)
    }

    fn client(&self, peer: &Peer) -> Result<reqwest::Client, ApiError> {
        self.peer_client(peer, Some(peer.fingerprint.clone()))
    }

    fn peer_client(
        &self,
        peer: &Peer,
        fingerprint: Option<String>,
    ) -> Result<reqwest::Client, ApiError> {
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .tls_info(true)
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(0);
        if peer.protocol == "https" {
            let provider = Arc::new(rustls::crypto::ring::default_provider());
            let certs = rustls_pemfile::certs(&mut Cursor::new(self.identity.cert.as_bytes()))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| ApiError::new(503, "Identité TLS invalide."))?;
            let key = rustls_pemfile::private_key(&mut Cursor::new(self.identity.key.as_bytes()))
                .map_err(|_| ApiError::new(503, "Identité TLS invalide."))?
                .ok_or_else(|| ApiError::new(503, "Clé TLS manquante."))?;
            let config = rustls::ClientConfig::builder_with_provider(provider.clone())
                .with_safe_default_protocol_versions()
                .map_err(|_| ApiError::new(503, "TLS indisponible."))?
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(PinnedCertificate {
                    fingerprint,
                    provider,
                }))
                .with_client_auth_cert(certs, key)
                .map_err(|_| ApiError::new(503, "Identité TLS invalide."))?;
            builder = builder.use_preconfigured_tls(config);
        }
        builder
            .build()
            .map_err(|_| ApiError::new(503, "Client LocalSend indisponible."))
    }

    async fn connect(self: &Arc<Self>, value: &str) -> Result<Value, ApiError> {
        let address = manual_address(value, self.options.allow_loopback).ok_or_else(|| {
            ApiError::new(400, "Indique une adresse IP locale et un port valide, par exemple 192.168.1.42:53317.")
        })?;
        self.start().await?;
        let endpoint = Peer {
            id: token(),
            alias: String::new(),
            device_type: "desktop".into(),
            device_model: None,
            protocol: "https".into(),
            fingerprint: String::new(),
            address: address.ip(),
            port: address.port(),
            seen_at: now(),
        };
        // Bootstrap only this user-selected numeric endpoint; subsequent sends pin its certificate.
        let response = self
            .peer_client(&endpoint, None)?
            .post(endpoint.url("register"))
            .json(&self.information())
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|_| ApiError::new(503, "Cet appareil LocalSend est indisponible. Vérifie l’IP, le port et le même réseau Wi-Fi."))?;
        if response.status() != StatusCode::OK {
            return Err(ApiError::new(503, "Cet appareil a refusé la connexion LocalSend."));
        }
        let certificate = response
            .extensions()
            .get::<reqwest::tls::TlsInfo>()
            .and_then(|info| info.peer_certificate())
            .map(digest)
            .ok_or_else(|| ApiError::new(503, "L’identité TLS de cet appareil est indisponible."))?;
        let information = read_response(response).await?;
        let mut peer = Peer::parse(
            &information,
            address.ip(),
            self.options.allow_loopback,
            false,
        )
        .filter(|peer| peer.protocol == "https" && peer.fingerprint == certificate)
        .ok_or_else(|| ApiError::new(503, "L’identité LocalSend ne correspond pas au certificat de cet appareil."))?;
        peer.port = address.port();
        self.remember_peer(peer)
            .await
            .ok_or_else(|| ApiError::new(409, "Cet appareil ne peut pas être ajouté à la recherche actuelle."))?;
        Ok(self.snapshot().await)
    }

    async fn start(self: &Arc<Self>) -> Result<(), ApiError> {
        let _lifecycle = self.lifecycle.lock().await;
        if self.disposed.load(Ordering::Acquire) {
            return Err(ApiError::new(503, "LocalSend est fermé."));
        }
        if self.state.lock().await.available {
            return Ok(());
        }
        {
            let mut state = self.state.lock().await;
            state.status = "starting".into();
            state.error = None;
        }
        match self.open_network().await {
            Ok(network) => {
                *self.network.lock().await = Some(network);
                let mut state = self.state.lock().await;
                state.available = true;
                state.status = "discovering".into();
                state.error = None;
                Ok(())
            }
            Err(error) => {
                let mut state = self.state.lock().await;
                state.available = false;
                state.status = "error".into();
                state.error = Some("LocalSend ne peut pas écouter le réseau local. Vérifie le réseau et les autorisations Windows.".into());
                Err(error)
            }
        }
    }

    async fn open_network(self: &Arc<Self>) -> Result<Network, ApiError> {
        let listener = std::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, self.options.port))
            .or_else(|error| {
                if error.kind() == std::io::ErrorKind::AddrInUse && self.options.port != 0 {
                    std::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
                } else {
                    Err(error)
                }
            })?;
        listener.set_nonblocking(true)?;
        self.port
            .store(listener.local_addr()?.port() as u64, Ordering::Release);
        let socket = if self.options.multicast {
            let udp = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
            udp.set_reuse_address(true)?;
            udp.bind(
                &SocketAddr::from((Ipv4Addr::UNSPECIFIED, self.options.discovery_port)).into(),
            )?;
            let mut joined = false;
            for interface in if_addrs::get_if_addrs().unwrap_or_default() {
                if let IpAddr::V4(ip) = interface.ip() {
                    if is_lan(ip.into(), false) && udp.join_multicast_v4(&GROUP, &ip).is_ok() {
                        joined = true;
                    }
                }
            }
            if !joined {
                udp.join_multicast_v4(&GROUP, &Ipv4Addr::UNSPECIFIED)?;
            }
            udp.set_multicast_ttl_v4(1)?;
            udp.set_nonblocking(true)?;
            Some(Arc::new(tokio::net::UdpSocket::from_std(udp.into())?))
        } else {
            None
        };
        let config = self.identity.server_config().await?;
        let handle = axum_server::Handle::new();
        let app = Router::new().fallback(handle_http).with_state(self.clone());
        let server_handle = handle.clone();
        let weak = Arc::downgrade(self);
        let allow_loopback = self.options.allow_loopback;
        let server = tokio::spawn(async move {
            let acceptor = LocalAcceptor {
                inner: RustlsAcceptor::new(config),
                connections: Arc::new(Semaphore::new(32)),
                allow_loopback,
            };
            let mut server = axum_server::from_tcp(listener)
                .acceptor(acceptor)
                .handle(server_handle);
            server
                .http_builder()
                .http1()
                .timer(hyper_util::rt::TokioTimer::new())
                .max_headers(30)
                .header_read_timeout(FIRST_REQUEST_TIMEOUT);
            if server
                .serve(app.into_make_service_with_connect_info::<SocketAddr>())
                .await
                .is_err()
            {
                if let Some(service) = weak.upgrade() {
                    let mut state = service.state.lock().await;
                    state.error =
                        Some("Le partage LocalSend est temporairement indisponible.".into());
                }
            }
        });
        let (stop, mut stopped) = watch::channel(false);
        let weak = Arc::downgrade(self);
        let maintenance = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(10));
            loop {
                tokio::select! { _ = stopped.changed() => break, _ = interval.tick() => {
                    let Some(service) = weak.upgrade() else { break; };
                    let mut state = service.state.lock().await; state.peers.retain(|_, peer| now().saturating_sub(peer.seen_at) < PEER_TTL);
                    state.rates.retain(|_, (at, _)| now().saturating_sub(*at) < 10000); drop(state);
                    service.announce(true).await;
                } }
            }
        });
        let mut tasks = vec![server, maintenance];
        if let Some(udp) = socket.clone() {
            let weak = Arc::downgrade(self);
            let mut stopped = stop.subscribe();
            tasks.push(tokio::spawn(async move {
                let mut bytes = [0u8; 4097];
                loop { tokio::select! { _ = stopped.changed() => break, received = udp.recv_from(&mut bytes) => {
                    let Ok((length, address)) = received else { break; };
                    if length > 4096 { continue; }
                    let Some(service) = weak.upgrade() else { break; };
                    if let Ok(value) = serde_json::from_slice::<Value>(&bytes[..length]) { service.datagram(value, address.ip()).await; }
                } } }
            }));
        }
        Ok(Network {
            handle,
            stop,
            tasks,
            socket,
        })
    }

    async fn announce(&self, announce: bool) {
        if !self.state.lock().await.available {
            return;
        }
        let socket = self
            .network
            .lock()
            .await
            .as_ref()
            .and_then(|network| network.socket.clone());
        if let Some(socket) = socket {
            let mut info = self.information();
            info["announce"] = announce.into();
            if let Ok(bytes) = serde_json::to_vec(&info) {
                let _ = socket
                    .send_to(&bytes, (GROUP, self.options.discovery_port))
                    .await;
            }
        }
    }

    async fn datagram(self: &Arc<Self>, value: Value, address: IpAddr) {
        let Some(peer) = self.remember(&value, address).await else {
            return;
        };
        if value["announce"] != true {
            return;
        }
        {
            let mut state = self.state.lock().await;
            if now().saturating_sub(*state.replies.get(&address).unwrap_or(&0)) < 3000 {
                return;
            }
            state.replies.insert(address, now());
            if state.replies.len() > MAX_PEERS {
                if let Some(key) = state.replies.keys().next().copied() {
                    state.replies.remove(&key);
                }
            }
        }
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            let Some(service) = weak.upgrade() else {
                return;
            };
            let response = async {
                let client = service.client(&peer)?;
                let response = client
                    .post(peer.url("register"))
                    .json(&service.information())
                    .timeout(Duration::from_secs(10))
                    .send()
                    .await
                    .map_err(|_| ApiError::new(503, "Appareil indisponible."))?;
                if response.status() != StatusCode::OK {
                    return Err(ApiError::new(503, "Appareil indisponible."));
                }
                read_response(response).await
            }
            .await;
            if let Ok(mut info) = response {
                info["port"] = peer.port.into();
                info["protocol"] = peer.protocol.into();
                let _ = service.remember(&info, address).await;
            } else {
                service.announce(false).await;
            }
        });
    }

    async fn stop(self: &Arc<Self>) {
        let _lifecycle = self.lifecycle.lock().await;
        let (offer, outgoing) = {
            let mut state = self.state.lock().await;
            state.available = false;
            state.status = "off".into();
            state.error = None;
            state.peers.clear();
            state.rates.clear();
            state.replies.clear();
            (state.offer.clone(), state.outgoing.clone())
        };
        if let Some(offer) = offer {
            self.release_offer(&offer, "cancelled", None).await;
        }
        if let Some(outgoing) = outgoing {
            outgoing.cancel.send_replace(true);
            self.result(&outgoing.id, "cancelled", None).await;
        }
        if let Some(network) = self.network.lock().await.take() {
            let _ = network.stop.send(true);
            network.handle.shutdown();
            for task in network.tasks {
                task.abort();
                let _ = task.await;
            }
        }
    }

    pub async fn dispose(self: &Arc<Self>) {
        self.disposed.store(true, Ordering::Release);
        self.stop().await;
    }

    async fn result(&self, id: &str, status: &str, error: Option<&str>) {
        let mut state = self.state.lock().await;
        if let Some(transfer) = state
            .transfer
            .as_mut()
            .filter(|transfer| transfer["id"] == id)
        {
            transfer["status"] = status.into();
            transfer["error"] = error.map(Value::from).unwrap_or(Value::Null);
            if status == "complete" {
                transfer["progress"] = 100.into();
                transfer["transferredBytes"] = transfer["totalBytes"].clone();
            }
        }
    }

    async fn progress(&self, id: &str, transferred: u64) {
        let mut state = self.state.lock().await;
        if let Some(transfer) = state.transfer.as_mut().filter(|transfer| {
            transfer["id"] == id
                && matches!(transfer["status"].as_str(), Some("receiving" | "sending"))
        }) {
            let total = transfer["totalBytes"].as_u64().unwrap_or_default();
            transfer["transferredBytes"] = transferred.min(total).into();
            transfer["progress"] = if total == 0 {
                0
            } else {
                ((100u128 * transferred as u128 / total as u128) as u64).min(99)
            }
            .into();
        }
    }

    async fn release_offer(&self, offer: &Arc<Offer>, status: &str, message: Option<&str>) {
        offer.cancelled.store(true, Ordering::Release);
        offer.cancel.send_replace(true);
        if let Some(response) = offer.response.lock().await.take() {
            let _ = response.send((403, Value::Null));
        }
        {
            let mut state = self.state.lock().await;
            if state
                .offer
                .as_ref()
                .is_some_and(|active| active.id == offer.id)
            {
                state.offer = None;
            }
        }
        self.result(&offer.id, status, message).await;
    }

    async fn accept(&self, id: &str) -> Result<Value, ApiError> {
        let offer = self.state.lock().await.offer.clone();
        let Some(offer) = offer.filter(|offer| {
            offer.id == id
                && !offer.accepted.load(Ordering::Acquire)
                && !offer.cancelled.load(Ordering::Acquire)
        }) else {
            return Ok(self
                .snapshot_error("Cette proposition n’est plus disponible.")
                .await);
        };
        let shelf = self.shelf.list().await?;
        let files = offer.files.lock().await;
        if shelf["items"].as_array().map_or(MAX_FILES, Vec::len) + files.len() > MAX_FILES {
            drop(files);
            self.release_offer(&offer, "rejected", None).await;
            return Ok(self
                .snapshot_error("Il n’y a pas assez de place dans l’étagère (20 fichiers maximum).")
                .await);
        }
        let mut response_files = serde_json::Map::new();
        for file in files.iter() {
            response_files.insert(file.id.clone(), file.token.clone().into());
        }
        let file_count = files.len();
        drop(files);
        let directory = self.directory.join("incoming");
        fs::create_dir_all(&directory).await?;
        verify_directory(&directory).await?;
        {
            let mut state = self.state.lock().await;
            if !state.offer.as_ref().is_some_and(|active| active.id == id)
                || offer.cancelled.load(Ordering::Acquire)
                || offer.accepted.swap(true, Ordering::AcqRel)
            {
                drop(state);
                return Ok(self
                    .snapshot_error("Cette proposition n’est plus disponible.")
                    .await);
            }
            state.transfer = Some(
                json!({"id":offer.id,"direction":"receive","peerId":null,"alias":offer.alias,"status":"receiving","totalBytes":offer.total_bytes,"transferredBytes":0,"progress":0,"fileCount":file_count,"error":null}),
            );
        }
        offer.activity.send_replace(());
        let response = offer.response.lock().await.take();
        if let Some(response) = response {
            if response
                .send((
                    200,
                    json!({"sessionId":offer.session_id,"files":response_files}),
                ))
                .is_err()
            {
                self.release_offer(&offer, "cancelled", None).await;
            }
        } else {
            self.release_offer(&offer, "cancelled", None).await;
        }
        Ok(self.snapshot().await)
    }

    async fn reject(&self, id: &str) -> Result<Value, ApiError> {
        let offer = self.state.lock().await.offer.clone();
        let Some(offer) =
            offer.filter(|offer| offer.id == id && !offer.accepted.load(Ordering::Acquire))
        else {
            return Ok(self
                .snapshot_error("Cette proposition n’est plus disponible.")
                .await);
        };
        self.release_offer(&offer, "rejected", None).await;
        Ok(self.snapshot().await)
    }

    async fn cancel(self: &Arc<Self>, id: &str) -> Result<Value, ApiError> {
        let (offer, outgoing) = {
            let state = self.state.lock().await;
            (state.offer.clone(), state.outgoing.clone())
        };
        if let Some(outgoing) = outgoing.filter(|outgoing| outgoing.id == id) {
            outgoing.cancel.send_replace(true);
            self.result(id, "cancelled", None).await;
            self.cancel_remote(&outgoing).await;
            return Ok(self.snapshot().await);
        }
        if let Some(offer) = offer.filter(|offer| offer.id == id) {
            self.release_offer(&offer, "cancelled", None).await;
            return Ok(self.snapshot().await);
        }
        Ok(self.snapshot_error("Ce transfert n’est plus actif.").await)
    }

    async fn cancel_remote(&self, outgoing: &Outgoing) {
        if let Some(session) = outgoing.session_id.lock().await.clone() {
            if let Ok(client) = self.client(&outgoing.peer) {
                let request = client
                    .post(outgoing.peer.url("cancel"))
                    .query(&[("sessionId", session)])
                    .timeout(Duration::from_secs(3));
                tokio::spawn(async move {
                    let _ = request.send().await;
                });
            }
        }
    }

    async fn send(
        self: &Arc<Self>,
        peer_id: &str,
        entries: Vec<SharedFile>,
    ) -> Result<Value, ApiError> {
        let (cancel, _) = watch::channel(false);
        let (activity, _) = watch::channel(());
        let outgoing = {
            let mut state = self.state.lock().await;
            let peer = state
                .peers
                .values()
                .find(|peer| peer.id == peer_id && now().saturating_sub(peer.seen_at) < PEER_TTL)
                .cloned();
            if !state.available || peer.is_none() {
                drop(state);
                return Ok(self
                    .snapshot_error("Cet appareil n’est plus à proximité.")
                    .await);
            }
            if state.outgoing.is_some() || state.offer.is_some() {
                drop(state);
                return Ok(self.snapshot_error("Un transfert est déjà en cours.").await);
            }
            let outgoing = Arc::new(Outgoing {
                id: token(),
                peer: peer.unwrap(),
                cancel,
                session_id: Mutex::new(None),
                activity,
            });
            state.outgoing = Some(outgoing.clone());
            state.transfer = Some(
                json!({"id":outgoing.id,"direction":"send","peerId":outgoing.peer.id,"alias":outgoing.peer.alias,"status":"preparing","totalBytes":0,"transferredBytes":0,"progress":0,"fileCount":entries.len(),"error":null}),
            );
            outgoing
        };
        let mut cancellation = outgoing.cancel.subscribe();
        let inactive = inactivity(outgoing.activity.subscribe(), self.options.session);
        let result = tokio::select! { _ = cancelled(&mut cancellation) => Err(ApiError::new(499, "Envoi annulé.")), _=inactive=>Err(ApiError::new(504,"Le transfert est resté sans activité.")), result = self.perform_send(&outgoing, entries) => result };
        if let Err(error) = result {
            let cancelled = *outgoing.cancel.borrow() || error.status == 499;
            self.result(
                &outgoing.id,
                if cancelled { "cancelled" } else { "error" },
                if cancelled {
                    None
                } else {
                    Some(error.message.as_str())
                },
            )
            .await;
            self.cancel_remote(&outgoing).await;
        }
        {
            let mut state = self.state.lock().await;
            if state
                .outgoing
                .as_ref()
                .is_some_and(|active| active.id == outgoing.id)
            {
                state.outgoing = None;
            }
        }
        Ok(self.snapshot().await)
    }

    async fn perform_send(
        self: &Arc<Self>,
        outgoing: &Arc<Outgoing>,
        entries: Vec<SharedFile>,
    ) -> Result<(), ApiError> {
        if entries.is_empty() || entries.len() > MAX_FILES {
            return Err(ApiError::new(400, "La sélection de fichiers est invalide."));
        }
        let mut sources = Vec::new();
        let mut metadata = serde_json::Map::new();
        let mut total = 0u64;
        for entry in entries {
            let source = Source::open(entry).await?;
            total = total
                .checked_add(source.size)
                .ok_or_else(|| ApiError::new(400, "La taille totale du lot est invalide."))?;
            outgoing.activity.send_replace(());
            metadata.insert(source.id.clone(), json!({"id":source.id,"fileName":source.name,"size":source.size,"fileType":"application/octet-stream"}));
            sources.push(source);
        }
        {
            let mut state = self.state.lock().await;
            if let Some(transfer) = state
                .transfer
                .as_mut()
                .filter(|transfer| transfer["id"] == outgoing.id)
            {
                transfer["totalBytes"] = total.into();
                transfer["status"] = "waiting".into();
            }
        }
        let client = self.client(&outgoing.peer)?;
        let response = client
            .post(outgoing.peer.url("prepare-upload"))
            .json(&json!({"info":self.information(),"files":metadata}))
            .timeout(self.options.consent + Duration::from_secs(5))
            .send()
            .await
            .map_err(|_| {
                ApiError::new(
                    503,
                    "L’envoi a échoué. L’appareil est indisponible ou son identité TLS a changé.",
                )
            })?;
        match response.status().as_u16() {
            401 => {
                self.result(
                    &outgoing.id,
                    "pin-required",
                    Some("Cet appareil demande un code PIN."),
                )
                .await;
                return Ok(());
            }
            403 => {
                self.result(
                    &outgoing.id,
                    "rejected",
                    Some("L’appareil a refusé le transfert."),
                )
                .await;
                return Ok(());
            }
            204 => {
                self.result(&outgoing.id, "complete", None).await;
                return Ok(());
            }
            200 => {}
            _ => {
                return Err(ApiError::new(
                    503,
                    "L’appareil a refusé la préparation du transfert.",
                ))
            }
        }
        let prepared = read_response(response).await?;
        outgoing.activity.send_replace(());
        let session = prepared["sessionId"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 256)
            .ok_or_else(|| ApiError::new(503, "Réponse LocalSend invalide."))?
            .to_string();
        let accepted = prepared["files"]
            .as_object()
            .ok_or_else(|| ApiError::new(503, "Réponse LocalSend invalide."))?;
        if accepted.keys().any(|id| !metadata.contains_key(id))
            || accepted
                .values()
                .any(|value| value.as_str().is_none_or(|v| v.is_empty() || v.len() > 256))
        {
            return Err(ApiError::new(503, "Réponse LocalSend invalide."));
        }
        *outgoing.session_id.lock().await = Some(session.clone());
        if accepted.is_empty() {
            self.result(
                &outgoing.id,
                "rejected",
                Some("Aucun fichier n’a été accepté."),
            )
            .await;
            return Ok(());
        }
        sources.retain(|source| accepted.contains_key(&source.id));
        total = sources.iter().map(|source| source.size).sum();
        {
            let mut state = self.state.lock().await;
            if let Some(transfer) = state
                .transfer
                .as_mut()
                .filter(|transfer| transfer["id"] == outgoing.id)
            {
                transfer["status"] = "sending".into();
                transfer["totalBytes"] = total.into();
                transfer["fileCount"] = sources.len().into();
            }
        }
        let counter = Arc::new(AtomicU64::new(0));
        for source in sources {
            source.check().await?;
            let file_id = source.id.clone();
            let size = source.size;
            let weak = Arc::downgrade(self);
            let id = outgoing.id.clone();
            let count = counter.clone();
            let activity = outgoing.activity.clone();
            let stream =
                futures_util::stream::try_unfold((source.file, 0u64), move |(mut file, read)| {
                    let weak = weak.clone();
                    let id = id.clone();
                    let count = count.clone();
                    let activity = activity.clone();
                    async move {
                        let mut bytes = vec![0u8; 65536];
                        let length = file.read(&mut bytes).await?;
                        if length == 0 {
                            if read != size {
                                return Err(std::io::Error::new(
                                    std::io::ErrorKind::UnexpectedEof,
                                    "Changed source",
                                ));
                            }
                            return Ok(None);
                        }
                        let next = read.checked_add(length as u64).ok_or_else(|| {
                            io::Error::new(io::ErrorKind::InvalidData, "Invalid source size")
                        })?;
                        if next > size {
                            return Err(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "Changed source",
                            ));
                        }
                        bytes.truncate(length);
                        activity.send_replace(());
                        let transferred =
                            count.fetch_add(length as u64, Ordering::AcqRel) + length as u64;
                        if let Some(service) = weak.upgrade() {
                            service.progress(&id, transferred).await;
                        }
                        Ok(Some((bytes, (file, next))))
                    }
                });
            let response = client
                .post(outgoing.peer.url("upload"))
                .query(&[
                    ("sessionId", session.as_str()),
                    ("fileId", file_id.as_str()),
                    ("token", accepted[&file_id].as_str().unwrap()),
                ])
                .header("Content-Type", "application/octet-stream")
                .header("Content-Length", size)
                .body(reqwest::Body::wrap_stream(stream))
                .send()
                .await
                .map_err(|_| ApiError::new(503, "Le transfert a été interrompu."))?;
            if response.status() != StatusCode::OK {
                return Err(ApiError::new(
                    503,
                    "L’appareil n’a pas confirmé le fichier envoyé.",
                ));
            }
            let _ = read_response(response).await?;
        }
        self.result(&outgoing.id, "complete", None).await;
        Ok(())
    }
}

struct Source {
    id: String,
    name: String,
    size: u64,
    modified: Option<SystemTime>,
    file: fs::File,
}
impl Source {
    async fn open(entry: SharedFile) -> Result<Self, ApiError> {
        let name = entry.item["name"].as_str().unwrap_or_default().to_string();
        let before = fs::symlink_metadata(&entry.path).await?;
        if !entry.path.is_absolute()
            || !safe_name(&name)
            || !before.is_file()
            || before.file_type().is_symlink()
        {
            return Err(ApiError::new(
                400,
                "La sélection de fichiers n’est plus disponible.",
            ));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if before.file_attributes() & 0x400 != 0 {
                return Err(ApiError::new(
                    400,
                    "Les liens de fichiers ne peuvent pas être partagés.",
                ));
            }
        }
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        options.custom_flags(0x00200000);
        let file = options.open(&entry.path).await?;
        let metadata = file.metadata().await?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(ApiError::new(
                    400,
                    "Les liens de fichiers ne peuvent pas être partagés.",
                ));
            }
        }
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|time| time.as_millis() as u64);
        if !metadata.is_file()
            || metadata.len() != before.len()
            || metadata.modified().ok() != before.modified().ok()
            || entry.item["size"]
                .as_u64()
                .is_some_and(|size| size != metadata.len())
            || entry.item["modifiedAt"]
                .as_u64()
                .is_some_and(|time| Some(time) != modified_ms)
        {
            return Err(ApiError::new(
                400,
                "La sélection de fichiers n’est plus disponible.",
            ));
        }
        Ok(Self {
            id: token(),
            name,
            size: metadata.len(),
            modified: metadata.modified().ok(),
            file,
        })
    }
    async fn check(&self) -> Result<(), ApiError> {
        let current = self.file.metadata().await?;
        if current.len() != self.size || current.modified().ok() != self.modified {
            return Err(ApiError::new(
                400,
                "Le fichier a changé depuis sa sélection.",
            ));
        }
        Ok(())
    }
}

pub fn valid_command(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    match value["command"].as_str().unwrap_or_default() {
        "discover" | "stop" => object.len() == 1,
        "connect" => {
            object.len() == 2
                && value["address"]
                    .as_str()
                    .is_some_and(|address| manual_address(address, false).is_some())
        }
        "accept" | "reject" | "cancel" => {
            object.len() == 2 && value["id"].as_str().is_some_and(opaque)
        }
        "share" => {
            if !(object.len() == 3 || object.len() == 4 && value["source"] == "files")
                || !value["peerId"].as_str().is_some_and(opaque)
            {
                return false;
            }
            value["ids"].as_array().is_some_and(|ids| {
                !ids.is_empty()
                    && ids.len() <= MAX_FILES
                    && ids.iter().all(|id| id.as_str().is_some_and(opaque))
                    && ids
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<HashSet<_>>()
                        .len()
                        == ids.len()
            })
        }
        _ => false,
    }
}

fn reply(status: u16, value: Value) -> Response {
    let code = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut response = if value.is_null() {
        (code, "").into_response()
    } else {
        (code, axum::Json(value)).into_response()
    };
    response
        .headers_mut()
        .insert("cache-control", "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    response
}

async fn read_json(request: Request, limit: usize) -> Result<Value, ApiError> {
    let declared = request
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok());
    if declared.is_some_and(|length| length > limit * 2) {
        return Err(ApiError::new(
            400,
            "Métadonnées LocalSend trop volumineuses.",
        ));
    }
    // Discard a small rejected tail so HTTP 400 reaches the sender instead of a TLS reset.
    let read = async {
        let mut stream = request.into_body().into_data_stream();
        let mut bytes = Vec::new();
        let mut length = 0usize;
        let mut oversized = declared.is_some_and(|length| length > limit);
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|_| ApiError::new(400, "Métadonnées LocalSend interrompues."))?;
            length = length
                .checked_add(chunk.len())
                .ok_or_else(|| ApiError::new(400, "Métadonnées LocalSend trop volumineuses."))?;
            if length > limit * 2 {
                return Err(ApiError::new(
                    400,
                    "Métadonnées LocalSend trop volumineuses.",
                ));
            }
            if length > limit {
                oversized = true;
            }
            if !oversized {
                bytes.extend_from_slice(&chunk);
            }
        }
        if oversized {
            return Err(ApiError::new(
                400,
                "Métadonnées LocalSend trop volumineuses.",
            ));
        }
        Ok::<_, ApiError>(bytes)
    };
    let bytes = tokio::time::timeout(Duration::from_secs(10), read)
        .await
        .map_err(|_| ApiError::new(400, "Métadonnées LocalSend interrompues."))??;
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| ApiError::new(400, "Métadonnées LocalSend invalides."))?;
    if !value.is_object() {
        return Err(ApiError::new(400, "Métadonnées LocalSend invalides."));
    }
    Ok(value)
}

async fn read_response(mut response: reqwest::Response) -> Result<Value, ApiError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ApiError::new(503, "Réponse LocalSend interrompue."))?
    {
        if bytes.len() + chunk.len() > MAX_JSON {
            return Err(ApiError::new(503, "Réponse LocalSend trop volumineuse."));
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        Ok(Value::Null)
    } else {
        serde_json::from_slice(&bytes)
            .map_err(|_| ApiError::new(503, "Réponse LocalSend invalide."))
    }
}

async fn inactivity(mut activity: watch::Receiver<()>, duration: Duration) {
    loop {
        tokio::select! {changed=activity.changed()=>{if changed.is_err(){return;}},_=tokio::time::sleep(duration)=>return}
    }
}

async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    while !*cancel.borrow() {
        if cancel.changed().await.is_err() {
            return;
        }
    }
}

struct PendingOffer {
    service: Weak<LocalSend>,
    offer: Arc<Offer>,
    armed: bool,
}
impl Drop for PendingOffer {
    fn drop(&mut self) {
        if self.armed {
            let weak = self.service.clone();
            let offer = self.offer.clone();
            tokio::spawn(async move {
                if let Some(service) = weak.upgrade() {
                    service.release_offer(&offer, "cancelled", None).await;
                }
            });
        }
    }
}

struct TemporaryUpload(PathBuf);
impl Drop for TemporaryUpload {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

async fn handle_http(
    State(service): State<Arc<LocalSend>>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    request: Request,
) -> Response {
    if !is_lan(address.ip(), service.options.allow_loopback) {
        return reply(403, Value::Null);
    }
    let Ok(_request) = service.requests.clone().try_acquire_owned() else {
        return reply(429, Value::Null);
    };
    let path = request.uri().path().to_string();
    if request.uri().to_string().len() > 2048 || !path.starts_with(PREFIX) {
        return reply(404, Value::Null);
    }
    let action = path.trim_start_matches(PREFIX).to_string();
    let method = request.method().clone();
    if action != "upload" {
        let mut state = service.state.lock().await;
        let stamp = now();
        let rate = state.rates.entry(address.ip()).or_insert((stamp, 0));
        if stamp.saturating_sub(rate.0) > 10000 {
            *rate = (stamp, 0);
        }
        rate.1 += 1;
        if rate.1 > 40 {
            return reply(429, Value::Null);
        }
        if state.rates.len() > MAX_PEERS {
            if let Some(key) = state.rates.keys().next().copied() {
                state.rates.remove(&key);
            }
        }
    }
    match (action.as_str(), method.as_str()) {
        ("info", "GET") => reply(200, service.information()),
        ("register", "POST") => {
            let fingerprint = request.extensions().get::<ClientFingerprint>().cloned();
            match read_json(request, MAX_JSON).await {
                Ok(mut value) => {
                    if value["protocol"] == "https" {
                        if let Some(fingerprint) = fingerprint {
                            value["fingerprint"] = fingerprint.0.into();
                        }
                    }
                    if service.remember(&value, address.ip()).await.is_some() {
                        reply(200, service.information())
                    } else {
                        reply(400, Value::Null)
                    }
                }
                Err(error) => reply(error.status, json!({"message":error.message})),
            }
        }
        ("prepare-upload", "POST") => prepare_http(service, address.ip(), request).await,
        ("upload", "POST") => upload_http(service, address.ip(), request).await,
        ("cancel", "POST") => {
            let params = reqwest::Url::parse(&format!("https://local{}", request.uri()))
                .ok()
                .map(|url| url.query_pairs().into_owned().collect::<HashMap<_, _>>())
                .unwrap_or_default();
            let offer = service.state.lock().await.offer.clone();
            if let Some(offer) = offer.filter(|offer| {
                offer.address == address.ip()
                    && Some(offer.session_id.as_str())
                        == params.get("sessionId").map(String::as_str)
            }) {
                service.release_offer(&offer, "cancelled", None).await;
                reply(200, Value::Null)
            } else {
                reply(403, Value::Null)
            }
        }
        _ => reply(404, Value::Null),
    }
}

async fn prepare_http(service: Arc<LocalSend>, address: IpAddr, request: Request) -> Response {
    {
        let state = service.state.lock().await;
        if state.offer.is_some() || state.outgoing.is_some() {
            return reply(409, Value::Null);
        }
    }
    let fingerprint = request.extensions().get::<ClientFingerprint>().cloned();
    let mut value = match read_json(request, MAX_OFFER_JSON).await {
        Ok(value) => value,
        Err(error) => {
            service.state.lock().await.error = Some(error.message.clone());
            return reply(error.status, json!({"message":error.message}));
        }
    };
    if value["info"]["protocol"] == "https" {
        if let Some(fingerprint) = fingerprint {
            value["info"]["fingerprint"] = fingerprint.0.into();
        }
    }
    let files = match parse_offer(&value) {
        Ok(files) => files,
        Err(error) => {
            service.state.lock().await.error = Some(error.message.clone());
            return reply(error.status, json!({"message":error.message}));
        }
    };
    let Some(peer) = Peer::parse(
        &value["info"],
        address,
        service.options.allow_loopback,
        true,
    ) else {
        return reply(
            400,
            json!({"message":"Les informations de cet appareil sont invalides."}),
        );
    };
    let (response, received) = oneshot::channel();
    let (cancel, _) = watch::channel(false);
    let (activity, _) = watch::channel(());
    let offer = Arc::new(Offer {
        id: token(),
        session_id: token(),
        address,
        alias: peer.alias,
        created_at: now(),
        total_bytes: files.iter().map(|file| file.size).sum(),
        files: Mutex::new(files),
        accepted: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
        cancel,
        response: Mutex::new(Some(response)),
        transferred: AtomicU64::new(0),
        activity,
    });
    {
        let mut state = service.state.lock().await;
        if state.offer.is_some() || state.outgoing.is_some() || !state.available {
            return reply(409, Value::Null);
        }
        state.error = None;
        state.offer = Some(offer.clone());
    }
    let mut pending = PendingOffer {
        service: Arc::downgrade(&service),
        offer: offer.clone(),
        armed: true,
    };
    let weak = Arc::downgrade(&service);
    let session_offer = offer.clone();
    let session_time = service.options.session;
    tokio::spawn(async move {
        let mut cancellation = session_offer.cancel.subscribe();
        tokio::select! { _ = cancelled(&mut cancellation) => return, _ = inactivity(session_offer.activity.subscribe(),session_time) => {} }
        if let Some(service) = weak.upgrade() {
            let current = service
                .state
                .lock()
                .await
                .offer
                .as_ref()
                .is_some_and(|active| active.id == session_offer.id);
            if current {
                service
                    .release_offer(&session_offer, "error", Some("Le transfert a expiré."))
                    .await;
            }
        }
    });
    let response = match tokio::time::timeout(service.options.consent, received).await {
        Ok(Ok((code, value))) => reply(code, value),
        _ => {
            service.release_offer(&offer, "rejected", None).await;
            reply(403, Value::Null)
        }
    };
    pending.armed = false;
    response
}

async fn upload_http(service: Arc<LocalSend>, address: IpAddr, request: Request) -> Response {
    let params = reqwest::Url::parse(&format!("https://local{}", request.uri()))
        .ok()
        .map(|url| url.query_pairs().into_owned().collect::<HashMap<_, _>>())
        .unwrap_or_default();
    let offer = service.state.lock().await.offer.clone();
    let Some(offer) = offer.filter(|offer| {
        offer.accepted.load(Ordering::Acquire)
            && !offer.cancelled.load(Ordering::Acquire)
            && offer.address == address
            && Some(offer.session_id.as_str()) == params.get("sessionId").map(String::as_str)
    }) else {
        return reply(403, Value::Null);
    };
    let file = {
        let mut files = offer.files.lock().await;
        let Some(file) = files.iter_mut().find(|file| {
            Some(file.id.as_str()) == params.get("fileId").map(String::as_str)
                && Some(file.token.as_str()) == params.get("token").map(String::as_str)
        }) else {
            return reply(403, Value::Null);
        };
        if file.status != "pending" {
            return reply(409, Value::Null);
        }
        if request
            .headers()
            .get("content-length")
            .is_some_and(|header| header.to_str().ok() != Some(file.size.to_string().as_str()))
        {
            return reply(400, Value::Null);
        }
        file.status = "receiving".into();
        file.clone()
    };
    let temporary =
        service
            .directory
            .join("incoming")
            .join(format!(".notchy-{}-{}.part", offer.id, token()));
    let _cleanup = TemporaryUpload(temporary.clone());
    let result = receive_file(&service, &offer, &file, request.into_body(), &temporary).await;
    let _ = fs::remove_file(&temporary).await;
    match result {
        Ok(()) => {
            let complete = {
                let mut files = offer.files.lock().await;
                if let Some(file) = files.iter_mut().find(|current| current.id == file.id) {
                    file.status = "complete".into();
                }
                files.iter().all(|file| file.status == "complete")
            };
            if complete {
                let mut state = service.state.lock().await;
                if state
                    .offer
                    .as_ref()
                    .is_some_and(|active| active.id == offer.id)
                {
                    state.offer = None;
                }
                drop(state);
                offer.cancel.send_replace(true);
                service.result(&offer.id, "complete", None).await;
            }
            reply(200, Value::Null)
        }
        Err(error) => {
            service
                .release_offer(
                    &offer,
                    if offer.cancelled.load(Ordering::Acquire) {
                        "cancelled"
                    } else {
                        "error"
                    },
                    Some("Le transfert a été interrompu."),
                )
                .await;
            reply(error.status, json!({"message":error.message}))
        }
    }
}

async fn receive_file(
    service: &Arc<LocalSend>,
    offer: &Arc<Offer>,
    file: &IncomingFile,
    body: Body,
    temporary: &Path,
) -> Result<(), ApiError> {
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temporary)
        .await?;
    let mut stream = body.into_data_stream();
    let mut received = 0u64;
    let mut hash = Sha256::new();
    let mut cancellation = offer.cancel.subscribe();
    loop {
        let chunk = tokio::select! { _ = cancelled(&mut cancellation) => return Err(ApiError::new(499, "Transfert annulé.")), chunk = tokio::time::timeout(Duration::from_secs(90), stream.next()) => chunk.map_err(|_| ApiError::new(500, "Le transfert a expiré."))? };
        let Some(chunk) = chunk else {
            break;
        };
        let bytes = chunk.map_err(|_| ApiError::new(500, "Envoi interrompu."))?;
        received = received
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| ApiError::new(400, "Taille du fichier invalide."))?;
        if received > file.size || offer.cancelled.load(Ordering::Acquire) {
            return Err(ApiError::new(400, "Taille du fichier invalide."));
        }
        hash.update(&bytes);
        output.write_all(&bytes).await?;
        offer.activity.send_replace(());
        let transferred = offer
            .transferred
            .fetch_add(bytes.len() as u64, Ordering::AcqRel)
            + bytes.len() as u64;
        service.progress(&offer.id, transferred).await;
    }
    if received != file.size {
        return Err(ApiError::new(400, "Le fichier reçu est incomplet."));
    }
    if file
        .checksum
        .as_ref()
        .is_some_and(|checksum| &format!("{:x}", hash.finalize()) != checksum)
    {
        return Err(ApiError::new(
            422,
            "La somme de contrôle ne correspond pas.",
        ));
    }
    output.sync_all().await?;
    drop(output);
    let _commit = service.receive_queue.lock().await;
    let current = service
        .state
        .lock()
        .await
        .offer
        .as_ref()
        .is_some_and(|active| active.id == offer.id);
    if !current
        || offer.cancelled.load(Ordering::Acquire)
        || service.disposed.load(Ordering::Acquire)
    {
        return Err(ApiError::new(499, "Transfert annulé."));
    }
    let saved = service
        .shelf
        .adopt_path(&file.name, temporary, file.size)
        .await?;
    let current = service
        .state
        .lock()
        .await
        .offer
        .as_ref()
        .is_some_and(|active| active.id == offer.id);
    if !current
        || offer.cancelled.load(Ordering::Acquire)
        || service.disposed.load(Ordering::Acquire)
    {
        if let Some(id) = saved["item"]["id"].as_str() {
            let _ = service.shelf.remove(id).await;
        }
        return Err(ApiError::new(499, "Transfert annulé."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn idle_protocol_detection_releases_the_connection_slot() {
        for prefix in [b"".as_slice(), b"P".as_slice()] {
            let connections = Arc::new(Semaphore::new(1));
            let (input, mut peer) = tokio::io::duplex(64);
            let mut stream = ConnectionStream::new(
                input,
                connections.clone().acquire_owned().await.unwrap(),
                Arc::new(AtomicBool::new(false)),
            );
            let deadline = tokio::time::Instant::now() + Duration::from_millis(100);
            stream.deadline.as_mut().reset(deadline);
            if !prefix.is_empty() {
                peer.write_all(prefix).await.unwrap();
                stream.read_exact(&mut [0]).await.unwrap();
                assert_eq!(stream.deadline.deadline(), deadline);
            }
            let pending = tokio::spawn(async move {
                stream.read(&mut [0]).await.unwrap_err()
            });
            let error = tokio::time::timeout(Duration::from_secs(1), pending)
                .await
                .expect("idle protocol detection kept a connection slot")
                .unwrap();
            assert_eq!(error.kind(), io::ErrorKind::TimedOut);
            assert_eq!(connections.available_permits(), 1);
            drop(peer);
        }
    }

    #[tokio::test]
    async fn first_request_allows_consent_and_refreshes_streaming_inactivity() {
        let connections = Arc::new(Semaphore::new(1));
        let (input, mut peer) = tokio::io::duplex(64);
        let received_request = Arc::new(AtomicBool::new(false));
        let mut stream = ConnectionStream::new(
            input,
            connections.clone().acquire_owned().await.unwrap(),
            received_request.clone(),
        );
        let mut service = ConnectionService {
            inner: Router::<()>::new(),
            fingerprint: None,
            received_request,
        };
        tower::Service::call(&mut service, Request::new(Body::empty()))
            .await
            .unwrap();
        stream.deadline.as_mut().reset(tokio::time::Instant::now());
        let response = b"consent response";
        stream.write_all(response).await.unwrap();
        let mut received = vec![0; response.len()];
        peer.read_exact(&mut received).await.unwrap();
        assert_eq!(received, response);
        assert!(stream.first_request.is_none());
        assert!(CONNECTION_IDLE_TIMEOUT > Options::default().consent);

        let short_deadline = tokio::time::Instant::now() + Duration::from_secs(1);
        stream.deadline.as_mut().reset(short_deadline);
        peer.write_all(b"upload chunk").await.unwrap();
        stream.read_exact(&mut [0; 12]).await.unwrap();
        assert!(stream.deadline.deadline() > short_deadline + Duration::from_secs(80));
        stream.deadline.as_mut().reset(short_deadline);
        stream.write_all(b"reply").await.unwrap();
        assert!(stream.deadline.deadline() > short_deadline + Duration::from_secs(80));
        drop(stream);
        assert_eq!(connections.available_permits(), 1);
    }

    #[tokio::test]
    async fn established_connections_release_the_slot_when_activity_stops() {
        let connections = Arc::new(Semaphore::new(1));
        let (input, _peer) = tokio::io::duplex(64);
        let mut stream = ConnectionStream::new(
            input,
            connections.clone().acquire_owned().await.unwrap(),
            Arc::new(AtomicBool::new(true)),
        );
        futures_util::future::poll_fn(|context| {
            stream.poll_deadline(context).unwrap();
            Poll::Ready(())
        })
        .await;
        stream
            .deadline
            .as_mut()
            .reset(tokio::time::Instant::now() + Duration::from_millis(100));
        let pending = tokio::spawn(async move {
            stream.read(&mut [0]).await.unwrap_err()
        });
        let error = tokio::time::timeout(Duration::from_secs(1), pending)
            .await
            .expect("idle established connection kept a connection slot")
            .unwrap();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert_eq!(connections.available_permits(), 1);
    }

    async fn fixture() -> (tempfile::TempDir, Arc<LocalSend>, reqwest::Client, String) {
        let directory = tempfile::Builder::new()
            .prefix("notchy-rust-localsend-")
            .tempdir()
            .unwrap();
        let shelf = Arc::new(Shelf::new(directory.path().join("shelf")).await.unwrap());
        let options = Options {
            port: 0,
            discovery_port: 0,
            allow_loopback: true,
            multicast: false,
            consent: Duration::from_secs(2),
            session: Duration::from_secs(10),
        };
        let service = Arc::new(
            LocalSend::with_options(directory.path().join("identity"), shelf, options)
                .await
                .unwrap(),
        );
        service.start().await.unwrap();
        let peer = Peer::parse(
            &service.information(),
            "127.0.0.1".parse().unwrap(),
            true,
            false,
        )
        .unwrap();
        let client = service.client(&peer).unwrap();
        let base = format!("https://127.0.0.1:{}{}", peer.port, PREFIX);
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if client.get(format!("{base}info")).send().await.is_ok() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        (directory, service, client, base)
    }

    fn offer_body(files: Value) -> Value {
        json!({"info":{"alias":"Test phone","version":"2.2","port":53317,"protocol":"https","deviceType":"mobile","fingerprint":"ignored-by-https-offer"},"files":files})
    }

    async fn wait_incoming(service: &LocalSend) -> Value {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let state = service.snapshot().await;
                if state["incoming"].is_object() {
                    return state["incoming"].clone();
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap()
    }

    async fn prepare(
        service: &Arc<LocalSend>,
        client: &reqwest::Client,
        base: &str,
        files: Value,
    ) -> (Value, JoinHandle<reqwest::Response>) {
        let client = client.clone();
        let url = format!("{base}prepare-upload");
        let response = tokio::spawn(async move {
            client
                .post(url)
                .json(&offer_body(files))
                .send()
                .await
                .unwrap()
        });
        (wait_incoming(service).await, response)
    }

    async fn uploaded_bytes(service: &LocalSend) -> Vec<Vec<u8>> {
        let state = service.shelf.list().await.unwrap();
        let mut bytes = Vec::new();
        for item in state["items"].as_array().unwrap() {
            let mut file = service
                .shelf
                .open(item["id"].as_str().unwrap(), false)
                .await
                .unwrap()
                .file;
            let mut content = Vec::new();
            file.read_to_end(&mut content).await.unwrap();
            bytes.push(content);
        }
        bytes.sort();
        bytes
    }

    #[test]
    fn manual_addresses_are_numeric_local_endpoints_without_url_escape() {
        for address in [
            "10.0.0.2",
            "172.16.0.8:53317",
            "192.168.1.2:1",
            "169.254.2.8:65535",
            "[::ffff:192.168.1.2]:53317",
        ] {
            assert!(manual_address(address, false).is_some(), "{address}");
            assert!(valid_command(&json!({"command":"connect","address":address})));
        }
        assert_eq!(manual_address("10.0.0.2", false).unwrap().port(), PORT);
        for address in [
            "", "localhost", "phone.local", "https://192.168.1.2", "192.168.1.2/path",
            "192.168.1.2:53317?x=1", "name@192.168.1.2", "192.168.1.2#x",
            "192.168.1.2:0", "192.168.1.2:65536", "192.168.1.2:-1", "192.168.1.2:http",
            " 192.168.1.2", "192.168.1.2 ", "8.8.8.8", "172.32.0.1", "127.0.0.1",
            "::1", "[fe80::1%3]:53317", "0.0.0.0", "224.0.0.167", "255.255.255.255",
        ] {
            assert!(manual_address(address, false).is_none(), "{address}");
            assert!(!valid_command(&json!({"command":"connect","address":address})));
        }
        assert!(!valid_command(&json!({"command":"connect","address":"10.0.0.2","extra":true})));
        assert!(manual_address("127.0.0.1:53317", true).is_some());
    }

    #[test]
    fn favorite_identity_tracks_the_certificate_instead_of_presence_or_alias() {
        let mut peer = Peer::parse(
            &json!({"version":"2.2","protocol":"https","port":53317,"fingerprint":"a".repeat(64),"alias":"First alias"}),
            "192.168.1.2".parse().unwrap(),
            false,
            false,
        )
        .unwrap();
        let identity = peer.public()["identity"].clone();
        assert_eq!(identity.as_str().unwrap().len(), 64);
        peer.id = token();
        peer.alias = "Renamed device".into();
        peer.address = "192.168.1.3".parse().unwrap();
        peer.port = 12345;
        assert_eq!(peer.public()["identity"], identity);
        peer.fingerprint = "b".repeat(64);
        assert_ne!(peer.public()["identity"], identity);
        peer.address = "::ffff:192.168.1.3".parse().unwrap();
        assert_eq!(peer.url("register"), "https://[::ffff:192.168.1.3]:12345/api/localsend/v2/register");
    }

    #[tokio::test]
    async fn manual_connection_registers_a_real_tls_peer_with_stable_identity() {
        let (_sender_directory, sender, _, _) = fixture().await;
        let (_receiver_directory, receiver, _, _) = fixture().await;
        let address = format!("127.0.0.1:{}", receiver.port.load(Ordering::Acquire));
        let state = sender.connect(&address).await.unwrap();
        assert_eq!(state["peers"].as_array().unwrap().len(), 1);
        let first = state["peers"][0].clone();
        assert_eq!(first["secure"], true);
        assert!(receiver.state.lock().await.peers.values().any(|peer| peer.fingerprint == sender.identity.fingerprint));
        let peer = sender.state.lock().await.peers.values().next().unwrap().clone();
        assert_eq!(peer.fingerprint, receiver.identity.fingerprint);
        assert_eq!(peer.port as u64, receiver.port.load(Ordering::Acquire));
        sender.stop().await;
        let reconnected = sender.connect(&address).await.unwrap();
        assert_eq!(reconnected["peers"][0]["identity"], first["identity"]);
        assert_ne!(reconnected["peers"][0]["id"], first["id"]);
        sender.dispose().await;
        receiver.dispose().await;
    }

    #[tokio::test]
    async fn manual_connection_never_adds_a_peer_with_a_mismatched_tls_identity() {
        let (_sender_directory, sender, _, _) = fixture().await;
        let (_receiver_directory, receiver, _, _) = fixture().await;
        let mut information = receiver.information();
        information["fingerprint"] = if receiver.identity.fingerprint == "a".repeat(64) {
            "b".repeat(64)
        } else {
            "a".repeat(64)
        }.into();
        let app = Router::new().route(
            "/api/localsend/v2/register",
            axum::routing::post(move || {
                let information = information.clone();
                async move { axum::Json(information) }
            }),
        );
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let handle = axum_server::Handle::new();
        let config = receiver.identity.server_config().await.unwrap();
        let server = tokio::spawn(
            axum_server::from_tcp_rustls(listener, config)
                .handle(handle.clone())
                .serve(app.into_make_service()),
        );
        let failure = sender.connect(&address.to_string()).await.unwrap_err();
        assert_eq!(failure.status, 503);
        assert!(failure.message.contains("identité"));
        assert!(sender.snapshot().await["peers"].as_array().unwrap().is_empty());
        handle.shutdown();
        server.await.unwrap().unwrap();
        sender.dispose().await;
        receiver.dispose().await;
    }

    #[test]
    fn validates_lan_names_and_metadata_without_rejecting_duplicate_basenames() {
        for address in [
            "10.0.0.2",
            "172.16.0.8",
            "172.31.1.9",
            "192.168.1.2",
            "169.254.2.8",
            "::ffff:192.168.1.2",
        ] {
            assert!(is_lan(address.parse().unwrap(), false), "{address}");
        }
        for address in ["8.8.8.8", "127.0.0.1", "172.32.0.1", "::1"] {
            assert!(!is_lan(address.parse().unwrap(), false), "{address}");
        }
        for name in [
            "../secret",
            "folder/file",
            "a\\file",
            "NUL.txt",
            "CON",
            "aux.png",
            "one:two",
            "file.",
            " file",
        ] {
            assert!(!safe_name(name), "{name}");
        }
        assert!(safe_name("Projet été.pdf"));
        assert_eq!(parse_offer(&json!({"files":{"one":{"id":"one","fileName":"photo.png","size":4},"two":{"id":"two","fileName":"photo.png","size":4}}})).unwrap().len(), 2);
        for file in [
            json!({"id":"other","fileName":"x","size":1}),
            json!({"id":"one","fileName":"../x","size":1}),
            json!({"id":"one","fileName":"x","size":-1}),
            json!({"id":"one","fileName":"x","size":1.5}),
        ] {
            assert!(parse_offer(&json!({"files":{"one":file}})).is_err());
        }
    }

    #[test]
    fn renderer_commands_are_opaque_and_strict() {
        let id = "a".repeat(32);
        let peer = "b".repeat(32);
        for value in [
            json!({"command":"discover"}),
            json!({"command":"accept","id":id}),
            json!({"command":"share","peerId":peer,"ids":[id],"source":"files"}),
        ] {
            assert!(valid_command(&value));
        }
        for value in [
            json!({"command":"discover","path":"C:\\private"}),
            json!({"command":"accept","id":"../private"}),
            json!({"command":"share","peerId":peer,"ids":[id,id]}),
            json!({"command":"share","peerId":peer,"ids":[id],"source":"outside"}),
        ] {
            assert!(!valid_command(&value));
        }
    }

    #[test]
    fn file_sizes_above_128_mib_and_8_gib_are_metadata_without_artificial_quotas() {
        let large = 9 * 1024u64.pow(3) + 1;
        let parsed =
            parse_offer(&json!({"files":{"one":{"id":"one","fileName":"large.bin","size":large}}}))
                .unwrap();
        assert_eq!(parsed[0].size, large);
        assert!(parse_offer(&json!({"files":{"one":{"id":"one","fileName":"one.bin","size":u64::MAX},"two":{"id":"two","fileName":"two.bin","size":1}}})).is_err());
        assert!(parse_offer(
            &json!({"files":{"one":{"id":"one","fileName":"one.bin","size":1.5}}})
        )
        .is_err());
    }

    #[test]
    fn pinned_tls_verifier_rejects_changed_certificate_before_application_data() {
        let verifier = PinnedCertificate {
            fingerprint: Some(digest(b"expected certificate")),
            provider: Arc::new(rustls::crypto::ring::default_provider()),
        };
        let server = ServerName::try_from("localhost").unwrap();
        assert!(verifier
            .verify_server_cert(
                &CertificateDer::from(b"changed certificate".as_slice()),
                &[],
                &server,
                &[],
                UnixTime::since_unix_epoch(Duration::ZERO)
            )
            .is_err());
    }

    #[tokio::test]
    async fn tls_identity_is_persistent_and_kept_out_of_public_state() {
        let (directory, service, _client, _base) = fixture().await;
        let first = service.identity.fingerprint.clone();
        assert!(!serde_json::to_string(&service.snapshot().await)
            .unwrap()
            .contains("PRIVATE KEY"));
        assert!(!serde_json::to_string(&service.snapshot().await)
            .unwrap()
            .contains("127.0.0.1"));
        service.dispose().await;
        let identity = Identity::load(&directory.path().join("identity"))
            .await
            .unwrap();
        assert_eq!(first, identity.fingerprint);
    }

    #[tokio::test]
    async fn registration_uses_the_authenticated_tls_client_certificate() {
        let (_directory, sender, _client, _base) = fixture().await;
        let (_remote_directory, receiver, _receiver_client, base) = fixture().await;
        let peer = Peer::parse(
            &receiver.information(),
            "127.0.0.1".parse().unwrap(),
            true,
            false,
        )
        .unwrap();
        let mut information = sender.information();
        information["fingerprint"] = "ignored-in-https-registration".into();
        let response = sender
            .client(&peer)
            .unwrap()
            .post(format!("{base}register"))
            .json(&information)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let state = receiver.state.lock().await;
        assert_eq!(state.peers.len(), 1);
        assert_eq!(
            state.peers.values().next().unwrap().fingerprint,
            sender.identity.fingerprint
        );
        drop(state);
        sender.dispose().await;
        receiver.dispose().await;
    }

    #[tokio::test]
    async fn eight_files_above_64k_metadata_receive_in_parallel_after_consent_only() {
        let (_directory, service, client, base) = fixture().await;
        let files = (0..8)
            .map(|index| {
                let id = format!("file-{index}");
                (
                    id.clone(),
                    json!({"id":id,"fileName":"photo.png","size":4,"preview":"X".repeat(12*1024)}),
                )
            })
            .collect::<serde_json::Map<_, _>>();
        let body = offer_body(Value::Object(files.clone()));
        assert!(serde_json::to_vec(&body).unwrap().len() > MAX_JSON);
        let (incoming, pending) = prepare(&service, &client, &base, Value::Object(files)).await;
        assert!(!pending.is_finished());
        assert_eq!(incoming["files"].as_array().unwrap().len(), 8);
        assert!(service.shelf.list().await.unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty());
        service
            .accept(incoming["id"].as_str().unwrap())
            .await
            .unwrap();
        let response = pending.await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let accepted = read_response(response).await.unwrap();
        let uploads = (0..8).map(|index| {
            let id = format!("file-{index}");
            let client = client.clone();
            let url = format!("{base}upload");
            let session = accepted["sessionId"].as_str().unwrap().to_string();
            let upload_token = accepted["files"][&id].as_str().unwrap().to_string();
            async move {
                let content = format!("{index:04}").into_bytes();
                let stream = futures_util::stream::iter(vec![
                    Ok::<_, std::io::Error>(content[..2].to_vec()),
                    Ok(content[2..].to_vec()),
                ]);
                let response = client
                    .post(url)
                    .query(&[
                        ("sessionId", session),
                        ("fileId", id),
                        ("token", upload_token),
                    ])
                    .body(reqwest::Body::wrap_stream(stream))
                    .send()
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK);
            }
        });
        futures_util::future::join_all(uploads).await;
        let state = service.snapshot().await;
        assert_eq!(state["transfer"]["status"], "complete");
        assert_eq!(state["transfer"]["progress"], 100);
        assert_eq!(state["transfer"]["transferredBytes"], 32);
        assert_eq!(
            uploaded_bytes(&service).await,
            (0..8)
                .map(|index| format!("{index:04}").into_bytes())
                .collect::<Vec<_>>()
        );
        let stored = service.shelf.list().await.unwrap();
        assert_eq!(
            stored["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item["id"].as_str().unwrap())
                .collect::<HashSet<_>>()
                .len(),
            8
        );
        assert_eq!(
            client
                .post(format!("{base}register"))
                .json(&json!({"padding":"X".repeat(70*1024)}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        service.dispose().await;
    }

    #[tokio::test]
    async fn refused_tokens_checksum_and_chunk_lengths_never_publish_invalid_bytes() {
        let (_directory, service, client, base) = fixture().await;
        for (payload, checksum, expected) in [
            (b"TES".as_slice(), None, 400u16),
            (b"TESTX".as_slice(), None, 400),
            (b"TEST".as_slice(), Some("0".repeat(64)), 422),
        ] {
            let (incoming, pending) = prepare(
                &service,
                &client,
                &base,
                json!({"one":{"id":"one","fileName":"demo.txt","size":4,"sha256":checksum}}),
            )
            .await;
            service
                .accept(incoming["id"].as_str().unwrap())
                .await
                .unwrap();
            let accepted = read_response(pending.await.unwrap()).await.unwrap();
            let query = [
                ("sessionId", accepted["sessionId"].as_str().unwrap()),
                ("fileId", "one"),
                ("token", "incorrect"),
            ];
            assert_eq!(
                client
                    .post(format!("{base}upload"))
                    .query(&query)
                    .body(b"TEST".to_vec())
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::FORBIDDEN
            );
            let query = [
                ("sessionId", accepted["sessionId"].as_str().unwrap()),
                ("fileId", "one"),
                ("token", accepted["files"]["one"].as_str().unwrap()),
            ];
            let stream =
                futures_util::stream::iter(vec![Ok::<_, std::io::Error>(payload.to_vec())]);
            let response = client
                .post(format!("{base}upload"))
                .query(&query)
                .body(reqwest::Body::wrap_stream(stream))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status().as_u16(), expected);
            assert!(service.shelf.list().await.unwrap()["items"]
                .as_array()
                .unwrap()
                .is_empty());
        }
        let (incoming, pending) = prepare(
            &service,
            &client,
            &base,
            json!({"one":{"id":"one","fileName":"refused.txt","size":4}}),
        )
        .await;
        service
            .reject(incoming["id"].as_str().unwrap())
            .await
            .unwrap();
        assert_eq!(pending.await.unwrap().status(), StatusCode::FORBIDDEN);
        assert!(service.shelf.list().await.unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty());
        service.dispose().await;
    }

    #[tokio::test]
    async fn selected_shelf_copy_streams_between_two_real_pinned_tls_instances() {
        let (directory, sender, _client, _base) = fixture().await;
        let (_receiver_directory, receiver, _receiver_client, _receiver_base) = fixture().await;
        let selected = directory.path().join("selected.txt");
        fs::write(&selected, b"selected fixture bytes")
            .await
            .unwrap();
        let saved = sender
            .shelf
            .add_path("Selected.txt", &selected, 22)
            .await
            .unwrap();
        sender
            .shelf
            .add_path("Keep local.txt", &selected, 22)
            .await
            .unwrap();
        let entries = sender
            .shelf
            .share_entries(&[saved["item"]["id"].as_str().unwrap().to_string()])
            .await
            .unwrap();
        let peer = sender
            .remember(&receiver.information(), "127.0.0.1".parse().unwrap())
            .await
            .unwrap();
        let receiver_copy = receiver.clone();
        let consent = tokio::spawn(async move {
            let incoming = wait_incoming(&receiver_copy).await;
            receiver_copy
                .accept(incoming["id"].as_str().unwrap())
                .await
                .unwrap();
        });
        let result = sender.send(&peer.id, entries).await.unwrap();
        consent.await.unwrap();
        assert_eq!(result["transfer"]["status"], "complete");
        assert_eq!(result["transfer"]["progress"], 100);
        assert_eq!(
            uploaded_bytes(&receiver).await,
            vec![b"selected fixture bytes".to_vec()]
        );
        let mut changed = receiver.information();
        changed["fingerprint"] = "0".repeat(64).into();
        let peer = sender
            .remember(&changed, "127.0.0.1".parse().unwrap())
            .await
            .unwrap();
        let entries = sender
            .shelf
            .share_entries(&[saved["item"]["id"].as_str().unwrap().to_string()])
            .await
            .unwrap();
        let result = sender.send(&peer.id, entries).await.unwrap();
        assert_eq!(result["transfer"]["status"], "error");
        assert!(receiver.snapshot().await["incoming"].is_null());
        assert_eq!(uploaded_bytes(&receiver).await.len(), 1);
        sender.dispose().await;
        receiver.dispose().await;
    }

    #[tokio::test]
    async fn outgoing_cancellation_during_consent_closes_the_request_without_file_bytes() {
        let (_directory, sender, _client, _base) = fixture().await;
        let (_receiver_directory, receiver, _receiver_client, _receiver_base) = fixture().await;
        let saved = sender
            .shelf
            .add_bytes("Selected.txt", b"fixture".to_vec())
            .await
            .unwrap();
        let entries = sender
            .shelf
            .share_entries(&[saved["item"]["id"].as_str().unwrap().to_string()])
            .await
            .unwrap();
        let peer = sender
            .remember(&receiver.information(), "127.0.0.1".parse().unwrap())
            .await
            .unwrap();
        let send_service = sender.clone();
        let pending =
            tokio::spawn(async move { send_service.send(&peer.id, entries).await.unwrap() });
        let _ = wait_incoming(&receiver).await;
        let state = sender.snapshot().await;
        assert_eq!(state["transfer"]["status"], "waiting");
        sender
            .cancel(state["transfer"]["id"].as_str().unwrap())
            .await
            .unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), pending)
                .await
                .unwrap()
                .unwrap()["transfer"]["status"],
            "cancelled"
        );
        assert!(receiver.shelf.list().await.unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty());
        sender.dispose().await;
        receiver.dispose().await;
    }

    #[tokio::test]
    async fn shelf_capacity_and_oversized_preview_metadata_are_rejected_before_upload() {
        let (_directory, service, client, base) = fixture().await;
        for index in 0..13 {
            service
                .shelf
                .add_bytes(&format!("Existing-{index}.txt"), vec![b'x'])
                .await
                .unwrap();
        }
        let files = (0..8)
            .map(|index| {
                let id = format!("file-{index}");
                (id.clone(), json!({"id":id,"fileName":"photo.png","size":4}))
            })
            .collect::<serde_json::Map<_, _>>();
        let (incoming, pending) = prepare(&service, &client, &base, Value::Object(files)).await;
        let state = service
            .accept(incoming["id"].as_str().unwrap())
            .await
            .unwrap();
        assert!(state["error"].as_str().unwrap().contains("20 fichiers"));
        assert_eq!(pending.await.unwrap().status(), StatusCode::FORBIDDEN);
        assert_eq!(
            service.shelf.list().await.unwrap()["items"]
                .as_array()
                .unwrap()
                .len(),
            13
        );
        let files = (0..20)
            .map(|index| {
                let id = format!("large-{index}");
                (
                    id.clone(),
                    json!({"id":id,"fileName":"photo.png","size":4,"preview":"X".repeat(60*1024)}),
                )
            })
            .collect::<serde_json::Map<_, _>>();
        let body = offer_body(Value::Object(files));
        assert!(serde_json::to_vec(&body).unwrap().len() > MAX_OFFER_JSON);
        assert_eq!(
            client
                .post(format!("{base}prepare-upload"))
                .json(&body)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert!(service.snapshot().await["incoming"].is_null());
        service.dispose().await;
    }
}
