//! Explicit local discovery fallback. TCP candidates are not peers until LocalSend verifies TLS.
use crate::ApiError;
use std::{net::{Ipv4Addr, SocketAddrV4, TcpStream}, sync::{mpsc, Arc, atomic::{AtomicBool,Ordering}}, time::Duration};

pub const PORT: u16 = 53317;
pub const CONCURRENCY: usize = 8;
const PROBE_TIMEOUT: Duration = Duration::from_millis(400);
static SCAN_ACTIVE: AtomicBool=AtomicBool::new(false);
struct ScanGuard;
impl Drop for ScanGuard {fn drop(&mut self){SCAN_ACTIVE.store(false,Ordering::Release);}}

pub fn is_private(ip: Ipv4Addr) -> bool {
    let [a,b,_,_] = ip.octets();
    a == 10 || a == 172 && (16..=31).contains(&b) || a == 192 && b == 168 || a == 169 && b == 254
}

pub fn parse_manual(value: &str) -> Result<SocketAddrV4, ApiError> {
    let invalid = || ApiError::new(400, "Indique une adresse IPv4 locale et un port valide.");
    if value.len() > 21 || value != value.trim() { return Err(invalid()); }
    let (host, port) = match value.split_once(':') {
        Some((host, port)) if !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()) =>
            (host, port.parse::<u16>().ok().filter(|port| *port != 0).ok_or_else(invalid)?),
        Some(_) => return Err(invalid()), None => (value, PORT),
    };
    let ip = host.parse::<Ipv4Addr>().map_err(|_| invalid())?;
    if host != ip.to_string() || !is_private(ip) { return Err(invalid()); }
    Ok(SocketAddrV4::new(ip,port))
}

pub fn first_candidates(local: Ipv4Addr, port: u16) -> Result<Vec<SocketAddrV4>, ApiError> {
    if !is_private(local) || port != PORT { return Err(ApiError::new(400, "Le scan est limité au réseau local et au port LocalSend.")); }
    let [a,b,c,_] = local.octets();
    Ok((1..=254).map(|host| Ipv4Addr::new(a,b,c,host)).filter(|ip| *ip != local)
        .map(|ip| SocketAddrV4::new(ip,port)).collect())
}

fn probe_candidates<F>(candidates: Vec<SocketAddrV4>, probe: F) -> Vec<SocketAddrV4>
where F: Fn(SocketAddrV4) -> bool + Send + Sync + 'static {
    let probe = Arc::new(probe); let mut found = Vec::new();
    for chunk in candidates.chunks(CONCURRENCY) {
        let (sender, receiver) = mpsc::channel(); let mut workers = Vec::new();
        for address in chunk.iter().copied() {
            let sender = sender.clone(); let probe = probe.clone();
            workers.push(std::thread::spawn(move || { if probe(address) { let _ = sender.send(address); } }));
        }
        drop(sender); found.extend(receiver);
        for worker in workers { let _ = worker.join(); }
    }
    found.sort_unstable(); found
}

pub async fn scan_subnet(local: Ipv4Addr, port: u16) -> Result<Vec<SocketAddrV4>, ApiError> {
    let candidates = first_candidates(local,port)?;
    if SCAN_ACTIVE.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err() {return Err(ApiError::new(409,"Une recherche locale est déjà en cours."));}
    let guard=ScanGuard;
    tokio::task::spawn_blocking(move || {let _guard=guard;probe_candidates(candidates, |address|
        TcpStream::connect_timeout(&address.into(),PROBE_TIMEOUT).is_ok())})
        .await.map_err(|_| ApiError::new(503,"Recherche locale indisponible."))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manual_endpoints_preserve_the_exact_lan_allowlist_and_numeric_ports() {
        for address in ["10.0.0.2","172.16.0.2:53317","172.31.255.2:65535","192.168.1.2:1","169.254.2.3"] { assert!(parse_manual(address).is_ok(),"{address}"); }
        for address in ["8.8.8.8","127.0.0.1","172.15.1.2","172.32.1.2","100.64.0.1","192.168.01.2"," 10.0.0.2","10.0.0.2 ","https://10.0.0.2","localhost","[::ffff:192.168.1.2]","10.0.0.2:0","10.0.0.2:65536","10.0.0.2:53317/path"] { assert!(parse_manual(address).is_err(),"{address}"); }
    }
    #[test]
    fn subnet_is_only_the_selected_private_24_excluding_self_network_and_broadcast() {
        let local = Ipv4Addr::new(192,168,8,21); let candidates=first_candidates(local,PORT).unwrap();
        assert_eq!(candidates.len(),253);
        assert!(candidates.iter().all(|address| address.ip().octets()[..3] == [192,168,8] && address.ip()!=&local && ![0,255].contains(&address.ip().octets()[3]) && address.port()==PORT));
        assert!(first_candidates(Ipv4Addr::new(8,8,8,8),PORT).is_err()); assert!(first_candidates(local,80).is_err());
    }
    #[test]
    fn injected_tcp_probe_is_bounded_and_does_not_promote_candidates_to_peers() {
        use std::sync::atomic::{AtomicUsize,Ordering};
        let active=Arc::new(AtomicUsize::new(0)); let peak=Arc::new(AtomicUsize::new(0));
        let candidates=first_candidates(Ipv4Addr::new(10,1,2,3),PORT).unwrap();
        let (working,maximum)=(active.clone(),peak.clone());
        let found=probe_candidates(candidates,move |address| {let count=working.fetch_add(1,Ordering::SeqCst)+1;maximum.fetch_max(count,Ordering::SeqCst);std::thread::sleep(Duration::from_millis(1));working.fetch_sub(1,Ordering::SeqCst);address.ip().octets()[3]==42});
        assert_eq!(found,vec![SocketAddrV4::new(Ipv4Addr::new(10,1,2,42),PORT)]); assert!(peak.load(Ordering::SeqCst)<=CONCURRENCY); assert_eq!(active.load(Ordering::SeqCst),0);
    }
}
