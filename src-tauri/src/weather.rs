use crate::{error::ApiError, native_bridge::read_frame};
use chrono::{NaiveDate, NaiveDateTime};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    fs,
    io::{AsyncWriteExt, BufReader},
    process::Command,
    sync::{watch, Mutex, Semaphore},
};
use tokio_util::sync::CancellationToken;

type Result<T> = std::result::Result<T, ApiError>;
const MAX_RESPONSE: usize = 262144;
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn empty() -> Value {
    json!({"status":"empty","mode":"local","selectedCity":null,"city":"","displayName":"","temperature":null,"feelsLike":null,"humidity":null,"windSpeed":null,"uvIndex":null,"sunrise":null,"condition":"","icon":"unknown","code":null,"isDay":null,"min":null,"max":null,"hours":[],"days":[],"nextRain":null,"rainRisk":null,"error":null,"stale":false,"fetchedAt":null,"locationStatus":null})
}
fn finite(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite())
}
fn integer(value: &Value) -> Option<i64> {
    finite(value)
        .filter(|n| n.fract() == 0.0 && n.abs() <= 9007199254740991.0)
        .map(|n| n as i64)
}

pub fn location(value: &Value) -> Option<Value> {
    let object = value.as_object()?;
    if object.keys().any(|key| {
        ![
            "id",
            "name",
            "country",
            "region",
            "latitude",
            "longitude",
            "timezone",
        ]
        .contains(&key.as_str())
    }) {
        return None;
    }
    let name = value["name"].as_str()?;
    if name.trim().is_empty()
        || name.encode_utf16().count() > 100
        || name.chars().any(char::is_control)
    {
        return None;
    }
    let latitude = finite(&value["latitude"]).filter(|n| n.abs() <= 90.0)?;
    let longitude = finite(&value["longitude"]).filter(|n| n.abs() <= 180.0)?;
    for key in ["country", "region"] {
        if let Some(value) = value.get(key) {
            let s = value.as_str()?;
            if s.encode_utf16().count() > 100 || s.chars().any(char::is_control) {
                return None;
            }
        }
    }
    let timezone = match value.get("timezone") {
        None => "auto",
        Some(value) => value.as_str()?,
    };
    if timezone.is_empty()
        || timezone.len() > 80
        || !timezone
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_+/".contains(&b))
    {
        return None;
    }
    let mut result = json!({"name":name.trim(),"country":value["country"].as_str().unwrap_or(""),"region":value["region"].as_str().unwrap_or(""),"latitude":latitude,"longitude":longitude,"timezone":timezone});
    if let Some(id) = value.get("id") {
        result["id"] = id.as_u64().filter(|id| *id <= 9007199254740991)?.into();
    }
    Some(result)
}
fn condition(code: i64, day: bool) -> (&'static str, &'static str) {
    match code {
        0 => ("Ciel dégagé", if day { "sun" } else { "moon" }),
        1 | 2 => (
            if code == 1 {
                "Peu nuageux"
            } else {
                "Partiellement nuageux"
            },
            if day { "cloud-sun" } else { "cloud-moon" },
        ),
        3 => ("Couvert", "cloud"),
        45 | 48 => ("Brouillard", "fog"),
        51 | 53 | 55 | 56 | 57 => ("Bruine", "drizzle"),
        61 | 63 | 65 | 66 | 67 | 80 | 81 | 82 => ("Pluie", "rain"),
        71 | 73 | 75 | 77 | 85 | 86 => ("Neige", "snow"),
        95 | 96 | 97 | 99 => ("Orage", "thunder"),
        _ => ("Conditions indisponibles", "unknown"),
    }
}
fn sample_time(value: &Value) -> Option<NaiveDateTime> {
    let s = value.as_str()?;
    if !matches!(s.len(), 16 | 19) || !s.is_ascii() {
        return None;
    }
    for (i, b) in s.bytes().enumerate() {
        let separator = match i {
            4 | 7 => Some(b'-'),
            10 => Some(b'T'),
            13 | 16 => Some(b':'),
            _ => None,
        };
        if let Some(separator) = separator {
            if b != separator {
                return None;
            }
        } else if !b.is_ascii_digit() {
            return None;
        }
    }
    NaiveDateTime::parse_from_str(
        s,
        if s.len() == 16 {
            "%Y-%m-%dT%H:%M"
        } else {
            "%Y-%m-%dT%H:%M:%S"
        },
    )
    .ok()
}
pub fn two_hour_rain(data: &Value) -> Value {
    let unavailable = json!({"available":false,"periodMinutes":120,"resolutionMinutes":15,"rainMm":null,"precipitationMm":null,"rainExpected":null,"samples":0});
    let Some(start) = sample_time(&data["current"]["time"]) else {
        return unavailable;
    };
    let Some(end) = start.checked_add_signed(chrono::Duration::minutes(120)) else {
        return unavailable;
    };
    let Some(times) = data["minutely_15"]["time"].as_array() else {
        return unavailable;
    };
    let mut records = HashMap::new();
    for (i, time) in times.iter().take(300).enumerate() {
        let Some(at) = sample_time(time).filter(|at| *at > start && *at <= end) else {
            continue;
        };
        let rain = finite(&data["minutely_15"]["rain"][i]).filter(|n| *n >= 0.0);
        let precipitation = finite(&data["minutely_15"]["precipitation"][i]).filter(|n| *n >= 0.0);
        if records.contains_key(&at) {
            records.insert(at, (None, None));
        } else {
            records.insert(at, (rain, precipitation));
        }
    }
    let samples = (1..=8)
        .map(|step| {
            start
                .checked_add_signed(chrono::Duration::minutes(step * 15))
                .and_then(|at| records.get(&at).copied())
        })
        .collect::<Vec<_>>();
    let rain_valid = samples
        .iter()
        .all(|sample| sample.is_some_and(|(rain, _)| rain.is_some()));
    let precipitation_valid = samples
        .iter()
        .all(|sample| sample.is_some_and(|(_, rain)| rain.is_some()));
    if !rain_valid && !precipitation_valid {
        let mut result = unavailable;
        result["samples"] = samples
            .iter()
            .filter(|sample| sample.is_some())
            .count()
            .into();
        return result;
    }
    let rain = rain_valid.then(|| {
        samples
            .iter()
            .filter_map(|sample| sample.and_then(|(rain, _)| rain))
            .sum::<f64>()
    });
    let precipitation = precipitation_valid.then(|| {
        samples
            .iter()
            .filter_map(|sample| sample.and_then(|(_, rain)| rain))
            .sum::<f64>()
    });
    json!({"available":true,"periodMinutes":120,"resolutionMinutes":15,"from":data["current"]["time"],"to":end.format("%Y-%m-%dT%H:%M").to_string(),"rainMm":rain,"precipitationMm":precipitation,"rainExpected":rain.map(|rain|rain>0.0),"samples":8})
}
pub fn project(data: &Value, city: &Value, mode: &Value) -> Value {
    let mut result = empty();
    result["mode"] = mode.clone();
    result["selectedCity"] = if mode == "city" {
        city.clone()
    } else {
        Value::Null
    };
    result["city"] = city["name"].clone();
    result["displayName"] = city["name"].clone();
    let current = &data["current"];
    let temperature = finite(&current["temperature_2m"]).filter(|n| n.abs() <= 100.0);
    let code = integer(&current["weather_code"]);
    let minimum = finite(&data["daily"]["temperature_2m_min"][0]);
    let maximum = finite(&data["daily"]["temperature_2m_max"][0]);
    if temperature.is_none() || code.is_none() || minimum.is_none() || maximum.is_none() {
        result["status"] = "error".into();
        result["error"] = "Météo indisponible. Vérifie ta connexion puis réessaie.".into();
        return result;
    }
    let day = current["is_day"] == 1;
    let (description, icon) = condition(code.unwrap(), day);
    let mut hours = Vec::new();
    if let (Some(start), Some(times)) = (
        sample_time(&current["time"]),
        data["hourly"]["time"].as_array(),
    ) {
        for (i, time) in times.iter().take(72).enumerate() {
            if !sample_time(time).is_some_and(|at| at >= start) {
                continue;
            }
            let (Some(temperature), Some(code)) = (
                finite(&data["hourly"]["temperature_2m"][i]),
                integer(&data["hourly"]["weather_code"][i]),
            ) else {
                continue;
            };
            let (description, icon) = condition(code, day);
            hours.push(json!({"time":time,"temperature":temperature,"code":code,"condition":description,"icon":icon,"precipitationProbability":finite(&data["hourly"]["precipitation_probability"][i]).map(|n|n.clamp(0.0,100.0))}));
            if hours.len() == 6 {
                break;
            }
        }
    }
    let rain_risk = hours
        .iter()
        .filter_map(|hour| finite(&hour["precipitationProbability"]))
        .reduce(f64::max);
    let mut days = Vec::new();
    if let Some(times) = data["daily"]["time"].as_array() {
        for (i, time) in times.iter().take(7).enumerate() {
            let Some(date) = time
                .as_str()
                .filter(|date| date.len() == 10 && date.is_ascii())
            else {
                continue;
            };
            let Ok(at) = NaiveDate::parse_from_str(date, "%Y-%m-%d") else {
                continue;
            };
            if at.format("%Y-%m-%d").to_string() != date
                || sample_time(&current["time"]).is_some_and(|current| at < current.date())
                || days.iter().any(|day: &Value| day["date"] == date)
            {
                continue;
            }
            let (Some(minimum), Some(maximum)) = (
                finite(&data["daily"]["temperature_2m_min"][i]).filter(|n| n.abs() <= 100.0),
                finite(&data["daily"]["temperature_2m_max"][i]).filter(|n| n.abs() <= 100.0),
            ) else {
                continue;
            };
            if minimum <= maximum {
                days.push(json!({"date":date,"min":minimum,"max":maximum}));
            }
            if days.len() == 3 {
                break;
            }
        }
    }
    let next = two_hour_rain(data);
    result["status"] = "ready".into();
    result["temperature"] = json!(temperature);
    result["feelsLike"] =
        json!(finite(&current["apparent_temperature"]).filter(|n| n.abs() <= 150.0));
    result["humidity"] =
        json!(integer(&current["relative_humidity_2m"]).filter(|n| (0..=100).contains(n)));
    result["windSpeed"] =
        json!(finite(&current["wind_speed_10m"]).filter(|n| (0.0..=400.0).contains(n)));
    let today = sample_time(&current["time"]).map(|at| at.date());
    let daily_index = today.and_then(|today| {
        let date = today.format("%Y-%m-%d").to_string();
        data["daily"]["time"]
            .as_array()?
            .iter()
            .take(7)
            .position(|value| value.as_str() == Some(date.as_str()))
    });
    // The detail shows today's forecast UV maximum, not an instantaneous reading.
    result["uvIndex"] = json!(daily_index.and_then(|index| {
        finite(&data["daily"]["uv_index_max"][index]).filter(|n| (0.0..=30.0).contains(n))
    }));
    result["sunrise"] = daily_index
        .and_then(|index| {
            sample_time(&data["daily"]["sunrise"][index])
                .filter(|at| Some(at.date()) == today)
                .map(|_| data["daily"]["sunrise"][index].clone())
        })
        .unwrap_or(Value::Null);
    result["condition"] = description.into();
    result["icon"] = icon.into();
    result["code"] = json!(code);
    result["isDay"] = day.into();
    result["min"] = json!(minimum);
    result["max"] = json!(maximum);
    result["hours"] = hours.into();
    result["days"] = days.into();
    result["nextRain"] = if next["available"] == true {
        next
    } else {
        Value::Null
    };
    result["rainRisk"] = json!(rain_risk);
    result["fetchedAt"] = now_ms().into();
    result
}
fn location_message(status: &str) -> &'static str {
    match status{"denied"=>"Windows refuse l’accès à la position. Autorise la localisation dans les paramètres Windows ou choisis une ville.","disabled"=>"La localisation Windows est désactivée. Active-la dans les paramètres Windows ou choisis une ville.","timeout"=>"Windows n’a pas pu déterminer la position à temps. Réessaie ou choisis une ville.","stale"=>"Windows n’a fourni qu’une ancienne position. Réessaie ou choisis une ville.",_=>"La position actuelle est indisponible sur cet ordinateur. Choisis une ville ou vérifie les paramètres Windows."}
}
pub fn normalize_position(raw: &Value, at: u64) -> Value {
    if !raw.is_object() || raw["status"] != "ready" {
        let status = raw["status"]
            .as_str()
            .filter(|s| matches!(*s, "denied" | "disabled" | "timeout" | "stale"))
            .unwrap_or("unavailable");
        return json!({"status":status,"error":location_message(status)});
    }
    let (Some(latitude), Some(longitude), Some(timestamp)) = (
        finite(&raw["latitude"]).filter(|n| n.abs() <= 90.0),
        finite(&raw["longitude"]).filter(|n| n.abs() <= 180.0),
        raw["timestamp"].as_u64(),
    ) else {
        return json!({"status":"unavailable","error":location_message("unavailable")});
    };
    if timestamp > at + 60000 || at.saturating_sub(timestamp) > 1200000 {
        return json!({"status":"stale","error":location_message("stale")});
    }
    let accuracy = finite(&raw["accuracy"])
        .filter(|n| *n >= 0.0 && *n <= 10000000.0)
        .map(|n| (n / 50.0).round() * 50.0);
    json!({"status":"ready","source":"windows","timestamp":timestamp,"accuracy":accuracy,"location":{"name":"Position actuelle","country":"","region":"","latitude":(latitude*100.0).round()/100.0,"longitude":(longitude*100.0).round()/100.0,"timezone":"auto"}})
}
#[derive(Clone)]
struct Cached {
    at: u64,
    value: Value,
}
struct Pending {
    key: String,
    ticket: u64,
    done: watch::Receiver<Option<Value>>,
}
struct WeatherState {
    value: Value,
    ticket: u64,
    cancelled: CancellationToken,
    pending: Option<Pending>,
}
pub struct Weather {
    client: reqwest::Client,
    file: PathBuf,
    native: PathBuf,
    state: Mutex<WeatherState>,
    operation: Mutex<()>,
    saving: Mutex<()>,
    forecasts: Mutex<HashMap<String, Cached>>,
    searches: Mutex<HashMap<String, Cached>>,
    search_pending: Mutex<HashMap<String, watch::Receiver<Option<Value>>>>,
    position: Mutex<Option<Cached>>,
    position_operation: Mutex<()>,
    disposed: AtomicBool,
    closed: CancellationToken,
    requests: Arc<Semaphore>,
    #[cfg(test)]
    routes: Option<[String; 2]>,
    #[cfg(test)]
    position_fixture: Mutex<Option<Value>>,
}
impl Weather {
    pub async fn new(file: PathBuf, native: PathBuf) -> anyhow::Result<Self> {
        let mut value = empty();
        let loaded = async {
            let metadata = fs::symlink_metadata(&file).await?;
            if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 4096 {
                return Err(ApiError::new(503, "Préférences météo invalides."));
            }
            let raw: Value = serde_json::from_slice(&fs::read(&file).await?)
                .map_err(|_| ApiError::new(503, "Préférences météo invalides."))?;
            if raw["version"] != 1 || !matches!(raw["mode"].as_str(), Some("city" | "local")) {
                return Err(ApiError::new(503, "Préférences météo invalides."));
            }
            if raw["mode"] == "city" {
                let city = location(&raw["location"])
                    .ok_or_else(|| ApiError::new(503, "Ville météo invalide."))?;
                value["mode"] = "city".into();
                value["city"] = city["name"].clone();
                value["displayName"] = city["name"].clone();
                value["selectedCity"] = city;
            }
            Ok::<_, ApiError>(())
        }
        .await;
        if loaded.is_err() && file.exists() {
            value["error"]="Les préférences météo ne peuvent pas être lues. Choisis une ville ou utilise ta position.".into();
        }
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            file,
            native,
            state: Mutex::new(WeatherState {
                value,
                ticket: 0,
                cancelled: CancellationToken::new(),
                pending: None,
            }),
            operation: Mutex::new(()),
            saving: Mutex::new(()),
            forecasts: Mutex::new(HashMap::new()),
            searches: Mutex::new(HashMap::new()),
            search_pending: Mutex::new(HashMap::new()),
            position: Mutex::new(None),
            position_operation: Mutex::new(()),
            disposed: AtomicBool::new(false),
            closed: CancellationToken::new(),
            requests: Arc::new(Semaphore::new(8)),
            #[cfg(test)]
            routes: None,
            #[cfg(test)]
            position_fixture: Mutex::new(None),
        })
    }
    fn live(&self) -> Result<()> {
        if self.disposed.load(Ordering::Acquire) {
            Err(ApiError::new(503, "Le service météo est fermé."))
        } else {
            Ok(())
        }
    }
    pub async fn snapshot(self: &Arc<Self>) -> Value {
        self.state.lock().await.value.clone()
    }
    async fn read(&self, url: url::Url, cancelled: &CancellationToken) -> Result<Value> {
        self.live()?;
        if url.scheme() != "https"
            || !matches!(
                url.host_str(),
                Some("api.open-meteo.com" | "geocoding-api.open-meteo.com")
            )
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.fragment().is_some()
        {
            return Err(ApiError::new(400, "Adresse météo refusée."));
        }
        let _permit = self
            .requests
            .clone()
            .try_acquire_owned()
            .map_err(|_| ApiError::new(429, "Une recherche météo est déjà en cours."))?;
        #[cfg(test)]
        let url = if let Some(routes) = &self.routes {
            let mut address = url::Url::parse(if url.host_str() == Some("api.open-meteo.com") {
                &routes[0]
            } else {
                &routes[1]
            })
            .unwrap();
            address.set_query(url.query());
            address
        } else {
            url
        };
        let operation = async {
            let mut response = self
                .client
                .get(url)
                .header("Accept", "application/json")
                .send()
                .await
                .map_err(|_| ApiError::new(503, "Service météo indisponible."))?;
            if !response.status().is_success()
                || response
                    .content_length()
                    .is_some_and(|n| n > MAX_RESPONSE as u64)
            {
                return Err(ApiError::new(
                    503,
                    "Réponse météo indisponible ou trop volumineuse.",
                ));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| ApiError::new(503, "Météo interrompue."))?
            {
                if bytes.len() + chunk.len() > MAX_RESPONSE {
                    return Err(ApiError::new(503, "Réponse météo trop volumineuse."));
                }
                bytes.extend_from_slice(&chunk);
            }
            serde_json::from_slice(&bytes)
                .map_err(|_| ApiError::new(503, "Réponse météo invalide."))
        };
        tokio::select! {_=cancelled.cancelled()=>Err(ApiError::new(499,"Mise à jour annulée.")),_=self.closed.cancelled()=>Err(ApiError::new(499,"Le service météo est fermé.")),result=operation=>result}
    }
    pub async fn search(&self, query: &str) -> Result<Value> {
        self.live()?;
        let text = query.trim();
        if !(2..=80).contains(&text.encode_utf16().count()) || query.chars().any(char::is_control) {
            return Err(ApiError::new(
                400,
                "Saisis un nom de ville entre 2 et 80 caractères.",
            ));
        }
        let key = text.to_lowercase();
        if let Some(cached) = self
            .searches
            .lock()
            .await
            .get(&key)
            .filter(|cached| now_ms().saturating_sub(cached.at) < 300000)
        {
            return Ok(cached.value.clone());
        }
        let (sender, receiver) = watch::channel(None);
        let existing = {
            let mut pending = self.search_pending.lock().await;
            pending.retain(|_, receiver| receiver.has_changed().is_ok());
            match pending.get(&key) {
                Some(receiver) if receiver.has_changed().is_ok() => Some(receiver.clone()),
                _ => {
                    pending.insert(key.clone(), receiver);
                    None
                }
            }
        };
        if let Some(receiver) = existing {
            return Ok(wait_result(receiver).await.unwrap_or_else(search_error));
        }
        let mut url = url::Url::parse("https://geocoding-api.open-meteo.com/v1/search").unwrap();
        url.query_pairs_mut().extend_pairs([
            ("name", text),
            ("count", "6"),
            ("language", "fr"),
            ("format", "json"),
        ]);
        let result = match self.read(url, &self.closed).await {
            Ok(data) if data.get("results").is_none_or(Value::is_array) => {
                let locations=data["results"].as_array().map(|items|items.iter().take(6).filter_map(|item|{let mut city=json!({"name":item["name"],"country":item["country"].as_str().unwrap_or(""),"region":item["admin1"].as_str().unwrap_or(""),"latitude":item["latitude"],"longitude":item["longitude"],"timezone":item["timezone"].as_str().unwrap_or("auto")});if let Some(id)=item.get("id"){city["id"]=id.clone();}location(&city)}).collect::<Vec<_>>()).unwrap_or_default();
                json!({"locations":locations})
            }
            _ => search_error(),
        };
        if result.get("error").is_none() {
            remember(
                &mut *self.searches.lock().await,
                key.clone(),
                result.clone(),
                20,
            );
        }
        sender.send_replace(Some(result.clone()));
        self.search_pending.lock().await.remove(&key);
        Ok(result)
    }
    pub async fn command(self: &Arc<Self>, command: Value) -> Result<Value> {
        self.live()?;
        let object = command
            .as_object()
            .ok_or_else(|| ApiError::new(400, "Commande météo invalide."))?;
        let name = command["command"].as_str().unwrap_or("");
        if !matches!(name, "local" | "refresh" | "select")
            || !(object.len() == 1 && name != "select" || object.len() == 2 && name == "select")
        {
            return Err(ApiError::new(400, "Commande météo invalide."));
        }
        let city = if name == "select" {
            Some(location(&command["location"]).ok_or_else(|| {
                ApiError::new(400, "Choisis une ville valide dans les résultats.")
            })?)
        } else {
            None
        };
        let key = serde_json::to_string(&json!([name, city])).unwrap();
        let (sender, ticket, cancelled, mode, selected) = {
            let mut state = self.state.lock().await;
            if let Some(pending) = state
                .pending
                .as_ref()
                .filter(|p| p.key == key && p.done.has_changed().is_ok())
            {
                let receiver = pending.done.clone();
                drop(state);
                return Ok(wait_result(receiver).await.unwrap_or_else(empty));
            }
            state.ticket += 1;
            state.cancelled.cancel();
            state.cancelled = CancellationToken::new();
            let mode = if name == "select" {
                "city"
            } else if name == "local" {
                "local"
            } else {
                state.value["mode"].as_str().unwrap_or("local")
            }
            .to_string();
            if name != "refresh" {
                state.value = empty();
                state.value["mode"] = mode.clone().into();
                if let Some(city) = &city {
                    state.value["selectedCity"] = city.clone();
                    state.value["city"] = city["name"].clone();
                    state.value["displayName"] = city["name"].clone();
                }
            }
            state.value["status"] = "loading".into();
            state.value["error"] = Value::Null;
            let (sender, done) = watch::channel(None);
            let ticket = state.ticket;
            state.pending = Some(Pending { key, ticket, done });
            (
                sender,
                ticket,
                state.cancelled.clone(),
                mode,
                state.value["selectedCity"].clone(),
            )
        };
        let _operation = self.operation.lock().await;
        let result = self
            .perform(name, &mode, selected, ticket, &cancelled)
            .await;
        let value = match result {
            Ok(value) => value,
            Err(error) => {
                let mut state = self.state.lock().await;
                if state.ticket == ticket && !self.disposed.load(Ordering::Acquire) {
                    state.value["status"] = "error".into();
                    state.value["error"] = error.message.into();
                }
                state.value.clone()
            }
        };
        sender.send_replace(Some(value.clone()));
        {
            let mut state = self.state.lock().await;
            if state.pending.as_ref().is_some_and(|p| p.ticket == ticket) {
                state.pending = None;
            }
        }
        Ok(value)
    }
    async fn perform(
        &self,
        command: &str,
        mode: &str,
        selected: Value,
        ticket: u64,
        cancelled: &CancellationToken,
    ) -> Result<Value> {
        if cancelled.is_cancelled() || self.disposed.load(Ordering::Acquire) {
            return Ok(self.state.lock().await.value.clone());
        }
        if command != "refresh" {
            self.persist(mode, &selected, ticket).await?;
        }
        let city = if mode == "city" {
            location(&selected).ok_or_else(|| ApiError::new(400, "Choisis une ville valide."))?
        } else {
            let position = self.position(cancelled).await;
            let mut state = self.state.lock().await;
            if state.ticket != ticket || cancelled.is_cancelled() {
                return Ok(state.value.clone());
            }
            state.value["locationStatus"] = position["status"].clone();
            if position["status"] != "ready" {
                state.value["status"] = "error".into();
                state.value["error"] = position["error"].clone();
                return Ok(state.value.clone());
            }
            location(&position["location"])
                .ok_or_else(|| ApiError::new(503, "Position indisponible. Choisis une ville."))?
        };
        let forecast = self.forecast(&city, mode, cancelled).await;
        let mut state = self.state.lock().await;
        if state.ticket != ticket
            || cancelled.is_cancelled()
            || self.disposed.load(Ordering::Acquire)
        {
            return Ok(state.value.clone());
        }
        let status = state.value["locationStatus"].clone();
        state.value = forecast;
        state.value["locationStatus"] = status;
        Ok(state.value.clone())
    }
    async fn forecast(&self, city: &Value, mode: &str, cancelled: &CancellationToken) -> Value {
        let key = format!(
            "{}|{}|{}",
            city["latitude"], city["longitude"], city["timezone"]
        );
        let cached = self.forecasts.lock().await.get(&key).cloned();
        if let Some(cached) = cached
            .as_ref()
            .filter(|cached| now_ms().saturating_sub(cached.at) < 600000)
        {
            let mut value = project(&cached.value, city, &json!(mode));
            value["fetchedAt"] = cached.at.into();
            return value;
        }
        let mut url = url::Url::parse("https://api.open-meteo.com/v1/forecast").unwrap();
        url.query_pairs_mut().extend_pairs([
            ("latitude", city["latitude"].to_string()),
            ("longitude", city["longitude"].to_string()),
            (
                "current",
                "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day".into(),
            ),
            (
                "hourly",
                "temperature_2m,weather_code,precipitation_probability".into(),
            ),
            (
                "daily",
                "temperature_2m_max,temperature_2m_min,uv_index_max,sunrise".into(),
            ),
            ("minutely_15", "rain,precipitation".into()),
            ("precipitation_unit", "mm".into()),
            ("wind_speed_unit", "kmh".into()),
            (
                "timezone",
                city["timezone"].as_str().unwrap_or("auto").into(),
            ),
            ("forecast_days", "3".into()),
        ]);
        if let Ok(data) = self.read(url, cancelled).await {
            let projected = project(&data, city, &json!(mode));
            if projected["status"] == "ready" {
                remember(&mut *self.forecasts.lock().await, key, data, 16);
                return projected;
            }
        }
        if let Some(cached) = cached {
            let mut value = project(&cached.value, city, &json!(mode));
            value["stale"] = true.into();
            value["fetchedAt"] = cached.at.into();
            value["error"] = format!(
                "Mise à jour indisponible — dernières données pour {}.",
                city["name"].as_str().unwrap_or("cette ville")
            )
            .into();
            value
        } else {
            project(&Value::Null, city, &json!(mode))
        }
    }
    async fn persist(&self, mode: &str, city: &Value, ticket: u64) -> Result<()> {
        let _saving = self.saving.lock().await;
        if self.state.lock().await.ticket != ticket {
            return Ok(());
        }
        let parent = self
            .file
            .parent()
            .ok_or_else(|| ApiError::new(503, "Préférences météo indisponibles."))?;
        check_directory(parent).await?;
        let data = if mode == "city" {
            json!({"version":1,"mode":"city","location":city})
        } else {
            json!({"version":1,"mode":"local"})
        };
        let temporary = parent.join(format!(".weather-{}.tmp", uuid::Uuid::new_v4().simple()));
        let _cleanup = TemporaryFile(temporary.clone());
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await?;
        file.write_all(
            &serde_json::to_vec(&data)
                .map_err(|_| ApiError::new(503, "Préférences météo invalides."))?,
        )
        .await?;
        file.sync_all().await?;
        drop(file);
        let state = self.state.lock().await;
        if state.ticket == ticket {
            fs::rename(&temporary, &self.file).await?;
        }
        Ok(())
    }
    async fn position(&self, cancelled: &CancellationToken) -> Value {
        let _operation = self.position_operation.lock().await;
        if let Some(cached) = self.position.lock().await.as_ref() {
            let ready = cached.value["status"] == "ready";
            let fresh = !ready
                || cached.value["timestamp"]
                    .as_u64()
                    .is_some_and(|at| now_ms().saturating_sub(at) <= 1200000);
            if fresh && now_ms().saturating_sub(cached.at) < if ready { 600000 } else { 60000 } {
                return cached.value.clone();
            }
        }
        #[cfg(test)]
        if let Some(raw) = self.position_fixture.lock().await.clone() {
            let value = normalize_position(&raw, now_ms());
            *self.position.lock().await = Some(Cached {
                at: now_ms(),
                value: value.clone(),
            });
            return value;
        }
        let raw = self.native_position(cancelled).await;
        let value = normalize_position(&raw, now_ms());
        if !cancelled.is_cancelled() && !self.disposed.load(Ordering::Acquire) {
            *self.position.lock().await = Some(Cached {
                at: now_ms(),
                value: value.clone(),
            });
        }
        value
    }
    async fn native_position(&self, cancelled: &CancellationToken) -> Value {
        #[cfg(not(windows))]
        {
            let _ = cancelled;
            return json!({"status":"unavailable"});
        }
        #[cfg(windows)]
        {
            let system = std::env::var_os("SystemRoot")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
            let executable = system.join("System32/WindowsPowerShell/v1.0/powershell.exe");
            let script = self.native.join("WeatherLocation.ps1");
            let mut command = Command::new(executable);
            command
                .args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                ])
                .arg(script)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .creation_flags(0x08000000);
            let Ok(mut child) = command.spawn() else {
                return json!({"status":"unavailable"});
            };
            let Some(stdout) = child.stdout.take() else {
                return json!({"status":"unavailable"});
            };
            let mut reader = BufReader::new(stdout);
            let output = async {
                let bytes = read_frame(&mut reader, 4096)
                    .await?
                    .ok_or_else(|| ApiError::new(503, "Position indisponible."))?;
                let status = child.wait().await?;
                if !status.success() {
                    return Err(ApiError::new(503, "Position indisponible."));
                }
                serde_json::from_slice::<Value>(&bytes)
                    .map_err(|_| ApiError::new(503, "Position Windows invalide."))
            };
            let result = tokio::select! {_=cancelled.cancelled()=>Err("unavailable"),_=self.closed.cancelled()=>Err("unavailable"),value=tokio::time::timeout(Duration::from_secs(15),output)=>match value{Ok(Ok(value))=>Ok(value),Ok(Err(_))=>Err("unavailable"),Err(_)=>Err("timeout")}};
            match result {
                Ok(value) => value,
                Err(status) => {
                    let _ = child.kill().await;
                    json!({"status":status})
                }
            }
        }
    }
    pub async fn dispose(&self) {
        self.disposed.store(true, Ordering::Release);
        self.closed.cancel();
        self.state.lock().await.cancelled.cancel();
        let _saving = self.saving.lock().await;
        self.position.lock().await.take();
    }
}
async fn wait_result(mut receiver: watch::Receiver<Option<Value>>) -> Option<Value> {
    loop {
        if let Some(value) = receiver.borrow().clone() {
            return Some(value);
        }
        if receiver.changed().await.is_err() {
            return None;
        }
    }
}
fn remember(cache: &mut HashMap<String, Cached>, key: String, value: Value, limit: usize) {
    cache.insert(
        key,
        Cached {
            at: now_ms(),
            value,
        },
    );
    while cache.len() > limit {
        if let Some(key) = cache
            .iter()
            .min_by_key(|(_, value)| value.at)
            .map(|(key, _)| key.clone())
        {
            cache.remove(&key);
        }
    }
}
fn search_error() -> Value {
    json!({"locations":[],"error":"Recherche de ville indisponible. Vérifie ta connexion puis réessaie."})
}
async fn check_directory(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(ApiError::new(503, "Préférences météo indisponibles."));
    }
    fs::create_dir_all(path).await?;
    let metadata = fs::symlink_metadata(path).await?;
    let actual = fs::canonicalize(path).await?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || actual
            .to_string_lossy()
            .trim_start_matches("\\\\?\\")
            .to_ascii_lowercase()
            != path
                .to_string_lossy()
                .trim_start_matches("\\\\?\\")
                .to_ascii_lowercase()
    {
        return Err(ApiError::new(503, "Préférences météo indisponibles."));
    }
    Ok(())
}
struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::{Request, State},
        response::{IntoResponse, Response},
        Router,
    };

    struct Mock {
        calls: Mutex<Vec<String>>,
        failed: AtomicBool,
        gate: Option<Arc<Semaphore>>,
    }
    struct Fixture {
        _directory: tempfile::TempDir,
        service: Arc<Weather>,
        mock: Arc<Mock>,
        server: tokio::task::JoinHandle<()>,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.server.abort();
        }
    }
    async fn mocked(State(mock): State<Arc<Mock>>, request: Request) -> Response {
        let path = request.uri().to_string();
        mock.calls.lock().await.push(path.clone());
        let url = url::Url::parse(&format!("http://localhost{path}")).unwrap();
        let params = url.query_pairs().into_owned().collect::<HashMap<_, _>>();
        if url.path() == "/forecast"
            && params
                .get("latitude")
                .is_some_and(|latitude| latitude == "48.8534")
        {
            if let Some(gate) = &mock.gate {
                let permit = gate.acquire().await.unwrap();
                permit.forget();
            }
        }
        if mock.failed.load(Ordering::Acquire) {
            return (axum::http::StatusCode::SERVICE_UNAVAILABLE, "").into_response();
        }
        let value = if url.path() == "/search" {
            let c = city();
            json!({"results":[{"id":c["id"],"name":c["name"],"country":c["country"],"admin1":c["region"],"latitude":c["latitude"],"longitude":c["longitude"],"timezone":c["timezone"]}]})
        } else {
            data()
        };
        axum::Json(value).into_response()
    }
    async fn fixture(gate: Option<Arc<Semaphore>>) -> Fixture {
        let directory = tempfile::tempdir().unwrap();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let mock = Arc::new(Mock {
            calls: Mutex::new(Vec::new()),
            failed: AtomicBool::new(false),
            gate,
        });
        let app = Router::new().fallback(mocked).with_state(mock.clone());
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let mut service = Weather::new(
            directory.path().join("weather.json"),
            directory.path().to_path_buf(),
        )
        .await
        .unwrap();
        service.routes = Some([format!("{base}/forecast"), format!("{base}/search")]);
        Fixture {
            _directory: directory,
            service: Arc::new(service),
            mock,
            server,
        }
    }
    fn city() -> Value {
        json!({"id":123,"name":"Ville de test","country":"France","region":"Région de test","latitude":48.8534,"longitude":2.3488,"timezone":"Europe/Paris"})
    }
    fn data() -> Value {
        json!({"current":{"temperature_2m":24,"apparent_temperature":18,"relative_humidity_2m":72,"wind_speed_10m":18.5,"weather_code":61,"is_day":1,"time":"2026-10-14T10:00"},"daily":{"time":["2026-10-14","2026-10-15","2026-10-16"],"temperature_2m_max":[26,27,25],"temperature_2m_min":[16,18,17],"uv_index_max":[3.5,4,2],"sunrise":["2026-10-14T05:34","2026-10-15T05:35","2026-10-16T05:36"]},"hourly":{"time":["2026-10-14T09:00","2026-10-14T10:00","2026-10-14T11:00","2026-10-14T12:00"],"temperature_2m":[12,24,25,24],"weather_code":[0,61,63,3],"precipitation_probability":[0,70,80,20]},"minutely_15":{"time":["2026-10-14T10:15","2026-10-14T10:30","2026-10-14T10:45","2026-10-14T11:00","2026-10-14T11:15","2026-10-14T11:30","2026-10-14T11:45","2026-10-14T12:00"],"rain":[0.1,0.2,0.1,0,0,0,0,0],"precipitation":[0.1,0.2,0.1,0,0,0,0,0]}})
    }
    #[test]
    fn location_rejects_untrusted_fields() {
        assert_eq!(location(&city()), Some(city()));
        for value in [
            json!({"name":"Paris","latitude":98,"longitude":2.3}),
            json!({"name":"Paris","latitude":48.8,"longitude":2.3,"url":"file:///secret"}),
            json!({"id":null,"name":"Paris","latitude":48.8,"longitude":2.3}),
            json!({"name":"Paris","latitude":48.8,"longitude":2.3,"timezone":"https://evil.invalid"}),
        ] {
            assert!(location(&value).is_none());
        }
        assert!(location(&json!({"name":"Equator","latitude":0,"longitude":0})).is_some());
    }
    #[test]
    fn forecast_preserves_real_values_and_two_hour_window() {
        let p = project(&data(), &city(), &json!("city"));
        assert_eq!(p["status"], "ready");
        assert_eq!(p["temperature"], 24.0);
        assert_eq!(p["feelsLike"], 18.0);
        assert_eq!(p["humidity"], 72);
        assert_eq!(p["windSpeed"], 18.5);
        assert_eq!(p["uvIndex"], 3.5);
        assert_eq!(p["sunrise"], "2026-10-14T05:34");
        assert_eq!(p["hours"].as_array().unwrap().len(), 3);
        assert_eq!(p["hours"][0]["temperature"], 24.0);
        assert_eq!(p["hours"][0]["condition"], "Pluie");
        assert_eq!(p["rainRisk"], 80.0);
        assert_eq!(
            p["days"],
            json!([
                {"date":"2026-10-14","min":16.0,"max":26.0},
                {"date":"2026-10-15","min":18.0,"max":27.0},
                {"date":"2026-10-16","min":17.0,"max":25.0}
            ])
        );
        assert_eq!(p["nextRain"]["samples"], 8);
        assert_eq!(p["nextRain"]["rainExpected"], true);
        assert_eq!(p["nextRain"]["to"], "2026-10-14T12:00");
        assert!(p["nextRain"].get("minutes").is_none());
    }
    #[test]
    fn optional_detail_metrics_reject_invalid_values_without_losing_current_weather() {
        for (source, field, parent, lower, upper) in [
            (
                "relative_humidity_2m",
                "humidity",
                "current",
                json!(0),
                json!(100),
            ),
            (
                "wind_speed_10m",
                "windSpeed",
                "current",
                json!(0.0),
                json!(400.0),
            ),
            ("uv_index_max", "uvIndex", "daily", json!(0.0), json!(30.0)),
        ] {
            for accepted in [lower, upper.clone()] {
                let mut value = data();
                if parent == "daily" {
                    value[parent][source][0] = accepted.clone();
                } else {
                    value[parent][source] = accepted.clone();
                }
                assert_eq!(project(&value, &city(), &json!("city"))[field], accepted);
            }
            for invalid in [
                Value::Null,
                json!("72"),
                json!(-1),
                json!(upper.as_f64().unwrap() + 1.0),
            ] {
                let mut value = data();
                if parent == "daily" {
                    value[parent][source][0] = invalid;
                } else {
                    value[parent][source] = invalid;
                }
                let projected = project(&value, &city(), &json!("city"));
                assert_eq!(projected["status"], "ready");
                assert!(
                    projected[field].is_null(),
                    "invalid {field} must remain unavailable"
                );
            }
        }
        let mut fractional = data();
        fractional["current"]["relative_humidity_2m"] = json!(72.5);
        assert!(project(&fractional, &city(), &json!("city"))["humidity"].is_null());
        for field in ["humidity", "windSpeed", "uvIndex", "sunrise"] {
            assert!(empty()[field].is_null());
        }
    }
    #[test]
    fn daily_detail_values_match_the_current_date_and_validate_sunrise() {
        let mut next_day = data();
        next_day["current"]["time"] = json!("2026-10-15T10:00");
        let projected = project(&next_day, &city(), &json!("city"));
        assert_eq!(projected["uvIndex"], 4.0);
        assert_eq!(projected["sunrise"], "2026-10-15T05:35");
        for invalid in [
            Value::Null,
            json!("2026-10-13T05:34"),
            json!("2026-02-30T05:34"),
            json!("2026-10-14T25:34"),
            json!("<svg onload=alert(1)>"),
            json!("2026-10-14 05:34"),
        ] {
            let mut value = data();
            value["daily"]["sunrise"][0] = invalid;
            assert!(project(&value, &city(), &json!("city"))["sunrise"].is_null());
        }
        let mut seconds = data();
        seconds["daily"]["sunrise"][0] = json!("2026-10-14T05:34:22");
        assert_eq!(
            project(&seconds, &city(), &json!("city"))["sunrise"],
            "2026-10-14T05:34:22"
        );
        for invalid in [
            Value::Null,
            json!("2026-02-30T10:00"),
            json!("2026-10-17T10:00"),
        ] {
            let mut value = data();
            value["current"]["time"] = invalid;
            let projected = project(&value, &city(), &json!("city"));
            assert!(projected["uvIndex"].is_null());
            assert!(projected["sunrise"].is_null());
        }
    }
    #[test]
    fn daily_forecast_never_invents_dates_or_invalid_temperatures() {
        let mut missing = data();
        missing["daily"]["time"] = Value::Null;
        assert_eq!(
            project(&missing, &city(), &json!("city"))["days"],
            json!([])
        );
        let mut invalid = data();
        invalid["daily"] = json!({
            "time":["2026-10-14","2026-10-14","2026-02-30","2026-10-16","2026-10-17","2026-10-18"],
            "temperature_2m_min":[16,12,13,25,101,17],
            "temperature_2m_max":[26,24,25,20,103,null]
        });
        assert_eq!(
            project(&invalid, &city(), &json!("city"))["days"],
            json!([
                {"date":"2026-10-14","min":16.0,"max":26.0}
            ])
        );
    }
    #[test]
    fn missing_or_ambiguous_rain_is_not_fabricated() {
        let mut missing = data();
        missing["minutely_15"] = Value::Null;
        assert!(project(&missing, &city(), &json!("city"))["nextRain"].is_null());
        let mut ambiguous = data();
        ambiguous["minutely_15"]["time"][7] = ambiguous["minutely_15"]["time"][6].clone();
        assert_eq!(two_hour_rain(&ambiguous)["available"], false);
        let mut p = data();
        p["minutely_15"]["rain"] = Value::Null;
        let rain = two_hour_rain(&p);
        assert_eq!(rain["available"], true);
        assert!(rain["rainExpected"].is_null());
        assert!(rain["rainMm"].is_null());
        assert_eq!(rain["samples"], 8);
    }
    #[test]
    fn weather_condition_and_invalid_response_remain_honest() {
        assert_eq!(condition(97, true), ("Orage", "thunder"));
        assert_eq!(condition(0, false).1, "moon");
        assert_eq!(condition(2, false).1, "cloud-moon");
        assert_eq!(condition(999, true).1, "unknown");
        let p = project(
            &json!({"current":{"temperature_2m":19,"weather_code":3,"is_day":1}}),
            &city(),
            &json!("city"),
        );
        assert_eq!(p["status"], "error");
        assert!(p["temperature"].is_null());
    }
    #[test]
    fn position_is_rounded_aged_and_permission_safe() {
        let at = 1800000000000;
        let p = normalize_position(
            &json!({"status":"ready","latitude":-4.3276123,"longitude":15.3136789,"accuracy":2044,"timestamp":at}),
            at,
        );
        assert_eq!(p["location"]["latitude"], -4.33);
        assert_eq!(p["location"]["longitude"], 15.31);
        assert_eq!(p["accuracy"], 2050.0);
        assert_eq!(
            normalize_position(
                &json!({"status":"ready","latitude":0,"longitude":0,"timestamp":at-1200001}),
                at
            )["status"],
            "stale"
        );
        for status in ["denied", "disabled", "timeout", "unavailable"] {
            let p = normalize_position(&json!({"status":status,"latitude":12,"longitude":13}), at);
            assert_eq!(p["status"], status);
            assert!(p.get("location").is_none());
            assert!(p["error"].as_str().unwrap().contains("ville"));
        }
    }
    #[tokio::test]
    async fn stored_city_loads_without_network_or_location_request() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("weather.json");
        fs::write(
            &file,
            serde_json::to_vec(&json!({"version":1,"mode":"city","location":city()})).unwrap(),
        )
        .await
        .unwrap();
        let service = Arc::new(
            Weather::new(file, directory.path().to_path_buf())
                .await
                .unwrap(),
        );
        let value = service.snapshot().await;
        assert_eq!(value["status"], "empty");
        assert_eq!(value["selectedCity"], city());
        assert_eq!(value["mode"], "city");
        assert!(service.position.lock().await.is_none());
        assert!(service.forecasts.lock().await.is_empty());
        service.dispose().await;
    }
    #[tokio::test]
    async fn corrupt_preferences_are_preserved_on_get() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("weather.json");
        fs::write(&file, b"{corrupt").await.unwrap();
        let service = Arc::new(
            Weather::new(file.clone(), directory.path().to_path_buf())
                .await
                .unwrap(),
        );
        assert!(service.snapshot().await["error"].is_string());
        assert_eq!(fs::read(&file).await.unwrap(), b"{corrupt");
        service.dispose().await;
    }

    #[tokio::test]
    async fn search_and_forecast_coalesce_cache_and_keep_selected_coordinates() {
        let f = fixture(None).await;
        assert_eq!(f.service.snapshot().await["status"], "empty");
        assert!(f.mock.calls.lock().await.is_empty());
        let values =
            futures_util::future::join_all((0..3).map(|_| f.service.search("Ville de test"))).await;
        assert!(values
            .iter()
            .all(|value| value.as_ref().unwrap()["locations"][0] == city()));
        assert_eq!(f.mock.calls.lock().await.len(), 1);
        let selected = f
            .service
            .command(json!({"command":"select","location":city()}))
            .await
            .unwrap();
        assert_eq!(selected["status"], "ready");
        assert_eq!(selected["nextRain"]["samples"], 8);
        let values = futures_util::future::join_all(
            (0..3).map(|_| f.service.command(json!({"command":"refresh"}))),
        )
        .await;
        assert!(values
            .iter()
            .all(|value| value.as_ref().unwrap()["status"] == "ready"));
        assert_eq!(f.mock.calls.lock().await.len(), 2);
        let calls = f.mock.calls.lock().await;
        let url = url::Url::parse(&format!("http://localhost{}", calls[1])).unwrap();
        let params = url.query_pairs().into_owned().collect::<HashMap<_, _>>();
        assert_eq!(params["latitude"], "48.8534");
        assert_eq!(params["precipitation_unit"], "mm");
        assert_eq!(params["wind_speed_unit"], "kmh");
        assert!(params["current"]
            .split(',')
            .any(|field| field == "relative_humidity_2m"));
        assert!(params["current"]
            .split(',')
            .any(|field| field == "wind_speed_10m"));
        assert!(params["daily"]
            .split(',')
            .any(|field| field == "uv_index_max"));
        assert!(params["daily"].split(',').any(|field| field == "sunrise"));
        assert_eq!(selected["humidity"], 72);
        assert_eq!(selected["windSpeed"], 18.5);
        assert_eq!(selected["uvIndex"], 3.5);
        assert_eq!(selected["sunrise"], "2026-10-14T05:34");
        assert_eq!(params["forecast_days"], "3");
        assert_eq!(selected["days"].as_array().unwrap().len(), 3);
        drop(calls);
        f.service.dispose().await;
    }

    #[tokio::test]
    async fn local_permission_uses_rounded_windows_position_without_persisting_coordinates() {
        let f = fixture(None).await;
        *f.service.position_fixture.lock().await = Some(
            json!({"status":"ready","latitude":-4.3276123,"longitude":15.3136789,"timestamp":now_ms()}),
        );
        let values = futures_util::future::join_all(
            (0..2).map(|_| f.service.command(json!({"command":"local"}))),
        )
        .await;
        assert!(values
            .iter()
            .all(|value| value.as_ref().unwrap()["status"] == "ready"));
        assert_eq!(f.mock.calls.lock().await.len(), 1);
        let value = f.service.snapshot().await;
        assert_eq!(value["city"], "Position actuelle");
        assert!(value["selectedCity"].is_null());
        assert_eq!(value["locationStatus"], "ready");
        let stored: Value =
            serde_json::from_slice(&fs::read(&f.service.file).await.unwrap()).unwrap();
        assert_eq!(stored, json!({"version":1,"mode":"local"}));
        let calls = f.mock.calls.lock().await;
        assert!(calls[0].contains("latitude=-4.33"));
        assert!(calls[0].contains("longitude=15.31"));
        drop(calls);
        f.service.dispose().await;
    }

    #[tokio::test]
    async fn denied_location_has_no_network_fallback_and_invalid_commands_are_closed() {
        let f = fixture(None).await;
        *f.service.position_fixture.lock().await = Some(json!({"status":"denied"}));
        let value = f.service.command(json!({"command":"local"})).await.unwrap();
        assert_eq!(value["status"], "error");
        assert_eq!(value["locationStatus"], "denied");
        assert!(f.mock.calls.lock().await.is_empty());
        for value in [
            json!({"command":"local","latitude":12}),
            json!({"command":"unknown"}),
            json!({"command":"select","location":{"name":"bad","latitude":91,"longitude":2}}),
        ] {
            assert_eq!(f.service.command(value).await.unwrap_err().status, 400);
        }
        for query in ["x", "Paris\n"] {
            assert_eq!(f.service.search(query).await.unwrap_err().status, 400);
        }
        f.service.dispose().await;
        assert_eq!(f.service.search("Paris").await.unwrap_err().status, 503);
    }

    #[tokio::test]
    async fn latest_city_cancels_previous_forecast_and_only_latest_preference_commits() {
        let gate = Arc::new(Semaphore::new(0));
        let f = fixture(Some(gate.clone())).await;
        let service = f.service.clone();
        let old = tokio::spawn(async move {
            service
                .command(json!({"command":"select","location":city()}))
                .await
                .unwrap()
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if !f.mock.calls.lock().await.is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let mut second = city();
        second["name"] = "Second city".into();
        second["latitude"] = (-4.33).into();
        let value = tokio::time::timeout(
            Duration::from_secs(2),
            f.service
                .command(json!({"command":"select","location":second})),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(value["city"], "Second city");
        assert_eq!(value["status"], "ready");
        let _ = old.await.unwrap();
        gate.add_permits(1);
        assert_eq!(f.service.snapshot().await["city"], "Second city");
        let stored: Value =
            serde_json::from_slice(&fs::read(&f.service.file).await.unwrap()).unwrap();
        assert_eq!(stored["location"]["name"], "Second city");
        f.service.dispose().await;
    }

    #[tokio::test]
    async fn failed_refresh_retains_only_the_same_city_stale_forecast() {
        let f = fixture(None).await;
        f.service
            .command(json!({"command":"select","location":city()}))
            .await
            .unwrap();
        for cached in f.service.forecasts.lock().await.values_mut() {
            cached.at = now_ms() - 600001;
        }
        f.mock.failed.store(true, Ordering::Release);
        let value = f
            .service
            .command(json!({"command":"refresh"}))
            .await
            .unwrap();
        assert_eq!(value["status"], "ready");
        assert_eq!(value["stale"], true);
        assert_eq!(value["temperature"], 24.0);
        assert!(value["error"].is_string());
        let mut other = city();
        other["latitude"] = 2.into();
        other["name"] = "Uncached city".into();
        let value = f
            .service
            .command(json!({"command":"select","location":other}))
            .await
            .unwrap();
        assert_eq!(value["status"], "error");
        assert!(value["temperature"].is_null());
        assert_eq!(value["city"], "Uncached city");
        f.service.dispose().await;
    }
}
