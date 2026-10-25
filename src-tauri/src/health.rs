//! Read-only diagnostics. A local listener is never evidence of an open firewall or working internet.
use crate::discovery;
use serde::Serialize;
use std::{net::{IpAddr,Ipv4Addr,SocketAddr,TcpStream,UdpSocket},time::Duration};

#[derive(Clone,Copy,Debug,PartialEq,Eq,Serialize)]
#[serde(rename_all="lowercase")]
pub enum CheckStatus { Ok, Warn, Blocked, Unknown }
#[derive(Clone,Debug,Serialize)]
pub struct HealthCheck { pub id: &'static str, pub label: &'static str, pub status: CheckStatus, pub detail: String }
#[derive(Clone,Copy,Debug,PartialEq,Eq,Serialize)]
pub enum NetworkCategory { Public, Private, DomainAuthenticated }
#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct HealthReport {
    pub checks: Vec<HealthCheck>, pub ready: usize, pub total: usize,
    pub local_ipv4: Option<Ipv4Addr>, pub network_category: Option<NetworkCategory>,
    pub localsend_port: u16, pub firewall_verified: bool,
}

pub fn local_ipv4() -> Option<Ipv4Addr> {
    let addresses=if_addrs::get_if_addrs().ok()?.into_iter().filter_map(|interface| match interface.ip() {
        IpAddr::V4(ip) if discovery::is_private(ip) && !interface.is_loopback() => Some(ip), _ => None,
    }).collect::<Vec<_>>();
    // UDP connect selects the outgoing route without sending a datagram.
    let preferred=UdpSocket::bind((Ipv4Addr::UNSPECIFIED,0)).and_then(|socket| {
        socket.connect((Ipv4Addr::new(192,0,2,1),9))?;
        socket.local_addr()
    }).ok().and_then(|address| match address.ip() {IpAddr::V4(ip)=>Some(ip),_=>None});
    select_local_ipv4(addresses,preferred)
}

fn select_local_ipv4(mut addresses:Vec<Ipv4Addr>,preferred:Option<Ipv4Addr>)->Option<Ipv4Addr> {
    if let Some(ip)=preferred.filter(|ip|addresses.contains(ip)) {return Some(ip);}
    addresses.sort_unstable_by_key(|ip| (ip.is_link_local(),*ip)); addresses.dedup(); addresses.into_iter().next()
}

fn category_from_json(text: &str) -> Option<NetworkCategory> {
    let value: serde_json::Value=serde_json::from_str(text.trim().trim_start_matches('\u{feff}')).ok()?;
    let names=if let Some(name)=value.as_str() {vec![name]} else {value.as_array()?.iter().map(serde_json::Value::as_str).collect::<Option<Vec<_>>>()?};
    if names.contains(&"Public") {Some(NetworkCategory::Public)} else if names.contains(&"DomainAuthenticated") {Some(NetworkCategory::DomainAuthenticated)} else if names.contains(&"Private") {Some(NetworkCategory::Private)} else {None}
}

#[cfg(windows)]
pub fn network_category() -> Option<NetworkCategory> {
    use std::{process::{Command,Stdio},os::windows::process::CommandExt,time::Instant};
    let mut child=Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command",
        "$ErrorActionPreference='Stop'; @(Get-NetConnectionProfile | Select-Object -ExpandProperty NetworkCategory | ForEach-Object { $_.ToString() } | Sort-Object -Unique) | ConvertTo-Json -Compress"])
        .creation_flags(0x08000000).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let started=Instant::now();
    loop {
        match child.try_wait() {Ok(Some(status)) if status.success()=>break,Ok(Some(_))|Err(_)=>return None,_=>{}}
        if started.elapsed()>Duration::from_secs(3) {let _=child.kill();let _=child.wait();return None;}
        std::thread::sleep(Duration::from_millis(10));
    }
    let output=child.wait_with_output().ok()?;
    if output.stdout.len()>4096 {return None;}
    category_from_json(std::str::from_utf8(&output.stdout).ok()?)
}
#[cfg(not(windows))]
pub fn network_category() -> Option<NetworkCategory> {None}

pub fn port_listening(ip: Ipv4Addr,port: u16) -> bool {
    port!=0 && TcpStream::connect_timeout(&SocketAddr::from((ip,port)),Duration::from_millis(400)).is_ok()
}

fn report(local: Option<Ipv4Addr>,category: Option<NetworkCategory>,port:u16,listening:Option<bool>,spotify:&str)->HealthReport {
    use CheckStatus::*;
    let (spotify_state,spotify_detail)=match spotify {
        "ok"|"ready"|"connected"=>(Ok,"Compte Spotify connecté"),
        "disconnected"=>(Warn,"Application Spotify configurée · compte non connecté"),
        "configuration-required"=>(Warn,"Configuration Spotify requise"),
        "configuration-invalid"=>(Warn,"Configuration Spotify invalide"),
        _=>(Unknown,"État Spotify non vérifié"),
    };
    let checks=vec![
        HealthCheck{id:"local-ipv4",label:"Adresse locale",status:if local.is_some(){Ok}else{Unknown},detail:local.map(|ip|ip.to_string()).unwrap_or_else(||"Aucune interface IPv4 privée détectée".into())},
        HealthCheck{id:"network-category",label:"Profil réseau",status:match category{Some(NetworkCategory::Public)=>Warn,Some(_)=>Ok,None=>Unknown},detail:match category{Some(NetworkCategory::Public)=>"Public · la découverte peut être filtrée",Some(NetworkCategory::Private)=>"Privé",Some(NetworkCategory::DomainAuthenticated)=>"Domaine authentifié",None=>"Profil réseau non vérifié"}.into()},
        HealthCheck{id:"localsend-port",label:"Port LocalSend",status:match listening{Some(true)=>Ok,Some(false)=>Blocked,None=>Unknown},detail:match listening{Some(true)=>format!("Port {port} joignable localement · pare-feu non vérifié"),Some(false)=>format!("Port {port} non joignable localement · service ou filtrage à vérifier"),None=>"Écoute locale non vérifiée".into()}},
        HealthCheck{id:"spotify",label:"Spotify",status:spotify_state,detail:spotify_detail.into()},
    ];
    let ready=checks.iter().filter(|check|check.status==Ok).count();
    HealthReport{total:checks.len(),checks,ready,local_ipv4:local,network_category:category,localsend_port:port,firewall_verified:false}
}

pub fn run(port:u16,spotify_status:&str)->HealthReport {
    let local=local_ipv4(); let category=network_category();
    let listening=local.map(|ip|port_listening(ip,port)); report(local,category,port,listening,spotify_status)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_address_prefers_the_routed_private_interface_over_a_smaller_vm_address() {
        let vm=Ipv4Addr::new(172,19,48,1); let wifi=Ipv4Addr::new(192,168,1,191);
        let addresses=vec![wifi,vm,wifi];
        assert_eq!(select_local_ipv4(addresses.clone(),Some(wifi)),Some(wifi));
        for preferred in [None,Some(Ipv4Addr::LOCALHOST),Some(Ipv4Addr::new(192,0,2,1))] {
            assert_eq!(select_local_ipv4(addresses.clone(),preferred),Some(vm));
        }
        assert_eq!(select_local_ipv4(vec![],Some(wifi)),None);
    }
    #[test]
    fn category_json_is_typed_and_public_is_never_hidden_by_another_adapter() {
        assert_eq!(category_from_json(r#"["Private","Public"]"#),Some(NetworkCategory::Public));
        assert_eq!(category_from_json(r#""DomainAuthenticated""#),Some(NetworkCategory::DomainAuthenticated));
        for value in ["null","3",r#"{"NetworkCategory":"Private"}"#,r#"["Private",true]"#,"garbage"] {assert_eq!(category_from_json(value),None);}
    }
    #[test]
    fn public_network_and_closed_port_are_not_ready_and_listener_never_proves_firewall() {
        let value=report(Some(Ipv4Addr::new(192,168,1,8)),Some(NetworkCategory::Public),discovery::PORT,Some(false),"disconnected");
        assert_eq!(value.total,4);assert_eq!(value.ready,1);assert_eq!(value.checks[1].status,CheckStatus::Warn);assert_eq!(value.checks[2].status,CheckStatus::Blocked);assert!(!value.firewall_verified);
        let listening=report(None,None,discovery::PORT,Some(true),"configuration-required");assert!(!listening.firewall_verified);assert_eq!(listening.checks[0].status,CheckStatus::Unknown);
    }
}
