#[cfg(not(mobile))]
pub use tauri_plugin_stronghold::{kdf, stronghold};

#[cfg(not(mobile))]
pub use iota_stronghold::Client;

#[cfg(mobile)]
pub mod kdf {
    use std::path::Path;

    #[derive(Clone)]
    pub struct KeyDerivation;

    impl KeyDerivation {
        pub fn argon2(_password: &str, _salt_path: &Path) -> Self {
            Self
        }
    }
}

#[cfg(mobile)]
pub mod stronghold {
    use std::{
        collections::HashMap,
        fs,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
    };

    use serde::{Deserialize, Serialize};

    use super::kdf::KeyDerivation;

    #[derive(Clone)]
    pub struct Stronghold {
        path: PathBuf,
        data: Arc<Mutex<MobileStrongholdData>>,
    }

    #[derive(Clone)]
    pub struct Client {
        path: Vec<u8>,
        data: Arc<Mutex<MobileStrongholdData>>,
    }

    #[derive(Clone)]
    pub struct Store {
        path: Vec<u8>,
        data: Arc<Mutex<MobileStrongholdData>>,
    }

    #[derive(Default, Serialize, Deserialize)]
    struct MobileStrongholdData {
        clients: HashMap<String, HashMap<String, Vec<u8>>>,
    }

    impl Stronghold {
        pub fn new(path: &Path, _key: KeyDerivation) -> Result<Self, String> {
            let data = if path.exists() {
                let bytes = fs::read(path).map_err(|error| error.to_string())?;
                serde_json::from_slice(&bytes).unwrap_or_default()
            } else {
                MobileStrongholdData::default()
            };

            Ok(Self {
                path: path.to_path_buf(),
                data: Arc::new(Mutex::new(data)),
            })
        }

        pub fn load_client(&self, path: &[u8]) -> Result<Client, String> {
            let key = client_key(path);
            let data = self.data.lock().map_err(|error| error.to_string())?;
            if data.clients.contains_key(&key) {
                Ok(Client {
                    path: path.to_vec(),
                    data: Arc::clone(&self.data),
                })
            } else {
                Err("mobile stronghold client not found".to_string())
            }
        }

        pub fn create_client(&self, path: &[u8]) -> Result<Client, String> {
            let key = client_key(path);
            let mut data = self.data.lock().map_err(|error| error.to_string())?;
            data.clients.entry(key).or_default();
            Ok(Client {
                path: path.to_vec(),
                data: Arc::clone(&self.data),
            })
        }

        pub fn save(&self) -> Result<(), String> {
            if let Some(parent) = self.path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let data = self.data.lock().map_err(|error| error.to_string())?;
            let bytes = serde_json::to_vec(&*data).map_err(|error| error.to_string())?;
            fs::write(&self.path, bytes).map_err(|error| error.to_string())
        }
    }

    impl Client {
        pub fn store(&self) -> Store {
            Store {
                path: self.path.clone(),
                data: Arc::clone(&self.data),
            }
        }
    }

    impl Store {
        pub fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>, String> {
            let client_key = client_key(&self.path);
            let data = self.data.lock().map_err(|error| error.to_string())?;
            Ok(data
                .clients
                .get(&client_key)
                .and_then(|client| client.get(&record_key(key)).cloned()))
        }

        pub fn insert(
            &self,
            key: Vec<u8>,
            value: Vec<u8>,
            _hint: Option<()>,
        ) -> Result<(), String> {
            let client_key = client_key(&self.path);
            let mut data = self.data.lock().map_err(|error| error.to_string())?;
            data.clients
                .entry(client_key)
                .or_default()
                .insert(record_key(&key), value);
            Ok(())
        }

        pub fn delete(&self, key: &[u8]) -> Result<(), String> {
            let client_key = client_key(&self.path);
            let mut data = self.data.lock().map_err(|error| error.to_string())?;
            if let Some(client) = data.clients.get_mut(&client_key) {
                client.remove(&record_key(key));
            }
            Ok(())
        }
    }

    fn client_key(path: &[u8]) -> String {
        String::from_utf8_lossy(path).to_string()
    }

    fn record_key(key: &[u8]) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut encoded = String::with_capacity(key.len() * 2);
        for byte in key {
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
        encoded
    }
}

#[cfg(mobile)]
pub use stronghold::Client;
