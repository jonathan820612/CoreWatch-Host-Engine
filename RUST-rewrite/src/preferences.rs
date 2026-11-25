use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::http::{Method, Request, Response, StatusCode, header};

const SETTINGS_FILE: &str = "dashboard-preferences.json";
const WALLPAPER_FILE: &str = "dashboard-wallpaper";
pub const WALLPAPER_SCHEME: &str = "corewatch-wallpaper";
pub const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;
const MAX_SETTINGS_BYTES: usize = 1024 * 1024;
const CARDS: &[&str] = &[
    "hardware", "identity", "storage", "infra", "network", "console",
];
const METRICS: &[&str] = &[
    "hw-cpu",
    "hw-gpu",
    "hw-vram",
    "hw-ram",
    "hw-pagefile",
    "hw-topproc",
    "id-host",
    "id-os",
    "id-runtime",
    "id-java",
    "id-telemetry",
    "id-stability",
    "infra-board",
    "infra-power",
    "infra-audio",
    "infra-display",
    "net-defender",
    "net-dnsarp",
    "net-drivers",
    "net-speedtest",
    "net-bandwidth",
];

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PollingProfile {
    Fast,
    #[default]
    Balanced,
    Eco,
}

impl PollingProfile {
    pub fn fast_interval(self) -> Duration {
        Duration::from_millis(match self {
            Self::Fast => 250,
            Self::Balanced => 500,
            Self::Eco => 1000,
        })
    }

    pub fn details_interval(self) -> Duration {
        Duration::from_millis(match self {
            Self::Fast => 1500,
            Self::Balanced => 2000,
            Self::Eco => 4000,
        })
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum TemperatureUnit {
    #[default]
    C,
    F,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Telemetry {
    pub polling_profile: PollingProfile,
    pub temperature_unit: TemperatureUnit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Layout {
    order: Vec<String>,
    #[serde(alias = "wideCards")]
    wide: Vec<String>,
    #[serde(alias = "hiddenCards")]
    hidden: Vec<String>,
    #[serde(alias = "collapsedCards")]
    collapsed: Vec<String>,
    hidden_metrics: Vec<String>,
    #[serde(alias = "dockedCards")]
    docked: Vec<String>,
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            order: CARDS.iter().map(|&id| id.to_owned()).collect(),
            wide: vec!["network".into(), "console".into()],
            hidden: Vec::new(),
            collapsed: Vec::new(),
            hidden_metrics: Vec::new(),
            docked: Vec::new(),
        }
    }
}

impl Layout {
    fn normalize(&mut self) {
        retain_unique(&mut self.order, CARDS);
        for &id in CARDS {
            if !self.order.iter().any(|existing| existing == id) {
                self.order.push(id.into());
            }
        }
        retain_unique(&mut self.wide, CARDS);
        retain_unique(&mut self.hidden, CARDS);
        retain_unique(&mut self.collapsed, CARDS);
        retain_unique(&mut self.hidden_metrics, METRICS);
        retain_unique(&mut self.docked, CARDS);
        self.docked.retain(|id| !self.hidden.contains(id));
    }
}

fn retain_unique(values: &mut Vec<String>, valid: &[&str]) {
    let mut seen = HashSet::new();
    values.retain(|value| valid.contains(&value.as_str()) && seen.insert(value.clone()));
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ImageFit {
    #[default]
    Cover,
    Contain,
    Stretch,
    Center,
    Tile,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Fade {
    None,
    Uniform,
    #[default]
    Vignette,
    Top,
    Bottom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Theme {
    preset_id: String,
    bg_app: String,
    bg_surface: String,
    bg_inset: String,
    bg_control: String,
    border: String,
    border_strong: String,
    accent: String,
    accent_light: String,
    accent_soft: String,
    text_primary: String,
    text_secondary: String,
    text_muted: String,
    surface_opacity: u8,
    card_blur: u8,
    bg_fit: ImageFit,
    bg_opacity: u8,
    bg_blur: u8,
    bg_fade_mode: Fade,
    bg_fade_strength: u8,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            preset_id: "classic".into(),
            bg_app: "#1a202c".into(),
            bg_surface: "#212936".into(),
            bg_inset: "#141923".into(),
            bg_control: "#2d3748".into(),
            border: "#323c4b".into(),
            border_strong: "#4a5568".into(),
            accent: "#3182ce".into(),
            accent_light: "#4299e1".into(),
            accent_soft: "#63b3ed".into(),
            text_primary: "#f7fafc".into(),
            text_secondary: "#cbd5e0".into(),
            text_muted: "#a0aec0".into(),
            surface_opacity: 100,
            card_blur: 0,
            bg_fit: ImageFit::Cover,
            bg_opacity: 45,
            bg_blur: 0,
            bg_fade_mode: Fade::Vignette,
            bg_fade_strength: 35,
        }
    }
}

impl Theme {
    pub(crate) fn normalize(&mut self) {
        let defaults = Self::default();
        for (value, fallback) in [
            (&mut self.bg_app, defaults.bg_app),
            (&mut self.bg_surface, defaults.bg_surface),
            (&mut self.bg_inset, defaults.bg_inset),
            (&mut self.bg_control, defaults.bg_control),
            (&mut self.border, defaults.border),
            (&mut self.border_strong, defaults.border_strong),
            (&mut self.accent, defaults.accent),
            (&mut self.accent_light, defaults.accent_light),
            (&mut self.accent_soft, defaults.accent_soft),
            (&mut self.text_primary, defaults.text_primary),
            (&mut self.text_secondary, defaults.text_secondary),
            (&mut self.text_muted, defaults.text_muted),
        ] {
            *value = normalize_hex(value).unwrap_or(fallback);
        }
        if ![
            "classic",
            "midnight",
            "cyberpunk",
            "emerald",
            "amber",
            "nord",
            "crimson",
            "synthwave",
            "aurora",
            "daylight",
            "custom",
        ]
        .contains(&self.preset_id.as_str())
        {
            self.preset_id = "custom".into();
        }
        self.surface_opacity = self.surface_opacity.clamp(35, 100);
        self.card_blur = self.card_blur.min(16);
        self.bg_opacity = self.bg_opacity.min(100);
        self.bg_blur = self.bg_blur.min(24);
        self.bg_fade_strength = self.bg_fade_strength.min(95);
    }
}

fn normalize_hex(value: &str) -> Option<String> {
    let value = value.trim().strip_prefix('#')?;
    if !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    match value.len() {
        3 => Some(format!(
            "#{}",
            value
                .chars()
                .flat_map(|ch| [ch.to_ascii_lowercase(); 2])
                .collect::<String>()
        )),
        6 => Some(format!("#{}", value.to_ascii_lowercase())),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub layout: Layout,
    pub telemetry: Telemetry,
    pub theme: Theme,
    pub always_on_top: bool,
    pub opacity: u8,
    pub general: General,
    pub directories: Directories,
    pub modules: Modules,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            layout: Layout::default(),
            telemetry: Telemetry::default(),
            theme: Theme::default(),
            always_on_top: false,
            opacity: 100,
            general: General::default(),
            directories: Directories::default(),
            modules: Modules::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct General {
    pub start_with_windows: bool,
    pub start_minimized: bool,
    pub minimize_to_tray_on_close: bool,
    pub confirm_destructive_actions: bool,
    pub auto_check_core_watch_updates: bool,
}

impl Default for General {
    fn default() -> Self {
        Self {
            start_with_windows: false,
            start_minimized: false,
            minimize_to_tray_on_close: false,
            confirm_destructive_actions: true,
            auto_check_core_watch_updates: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Directories {
    pub projects_root: String,
    pub exports_root: String,
    pub wsl_install_root: String,
    pub organizer_dest_root: String,
    pub editor_path: String,
}

impl Default for Directories {
    fn default() -> Self {
        let profile = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_default();
        Self {
            projects_root: profile.join("Documents").to_string_lossy().into_owned(),
            exports_root: profile
                .join("Documents/CoreWatch Exports")
                .to_string_lossy()
                .into_owned(),
            wsl_install_root: r"C:\WSL".into(),
            organizer_dest_root: profile.join("Organized").to_string_lossy().into_owned(),
            editor_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Modules {
    pub disabled: Vec<String>,
}

impl Settings {
    fn normalize(&mut self) {
        self.layout.normalize();
        self.theme.normalize();
        self.opacity = self.opacity.clamp(50, 100);
        retain_unique(&mut self.modules.disabled, &["netmanager", "tasksports"]);
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    layout: Option<Layout>,
    telemetry: Option<Telemetry>,
    theme: Option<Theme>,
    pub always_on_top: Option<bool>,
    pub opacity: Option<u8>,
    pub general: Option<General>,
    pub start_with_windows: Option<bool>,
    directories: Option<Directories>,
    modules: Option<Modules>,
}

impl Changes {
    fn apply(self, settings: &mut Settings) {
        if let Some(layout) = self.layout {
            settings.layout = layout;
        }
        if let Some(telemetry) = self.telemetry {
            settings.telemetry = telemetry;
        }
        if let Some(theme) = self.theme {
            settings.theme = theme;
        }
        if let Some(always_on_top) = self.always_on_top {
            settings.always_on_top = always_on_top;
        }
        if let Some(opacity) = self.opacity {
            settings.opacity = opacity;
        }
        if let Some(general) = self.general {
            settings.general = general;
        }
        if let Some(enabled) = self.start_with_windows {
            settings.general.start_with_windows = enabled;
        }
        if let Some(directories) = self.directories {
            settings.directories = directories;
        }
        if let Some(modules) = self.modules {
            settings.modules = modules;
        }
        settings.normalize();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub settings: Settings,
    initialized: bool,
    wallpaper_version: Option<u64>,
}

struct Wallpaper {
    mime: &'static str,
    bytes: Vec<u8>,
}

impl Wallpaper {
    fn parse(bytes: Vec<u8>) -> io::Result<Self> {
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(io::Error::other("Choose an image no larger than 12 MiB."));
        }
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(b"\xff\xd8\xff") {
            "image/jpeg"
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
            "image/webp"
        } else {
            return Err(io::Error::other("Choose a PNG, JPEG, or WebP image."));
        };
        Ok(Self { mime, bytes })
    }
}

#[derive(Default)]
struct Saved {
    settings: Settings,
    initialized: bool,
    wallpaper: Option<Wallpaper>,
    wallpaper_generation: u64,
}

pub struct Store {
    directory: Option<PathBuf>,
    legacy_directory: Option<PathBuf>,
    saved: Mutex<Saved>,
}

impl Store {
    pub fn open(directory: Option<PathBuf>, legacy_directory: Option<PathBuf>) -> Self {
        let mut saved = Saved::default();
        if let Some(path) = &directory {
            match read_json::<Settings>(&path.join(SETTINGS_FILE)) {
                Ok(Some(mut settings)) => {
                    settings.normalize();
                    saved.settings = settings;
                    saved.initialized = true;
                }
                Ok(None) => {}
                Err(error) => eprintln!("Dashboard preferences: {error}"),
            }
            match read_limited(&path.join(WALLPAPER_FILE), MAX_IMAGE_BYTES)
                .and_then(|bytes| bytes.map(Wallpaper::parse).transpose())
            {
                Ok(wallpaper) => saved.wallpaper = wallpaper,
                Err(error) => eprintln!("Dashboard wallpaper: {error}"),
            }
        }
        Self {
            directory,
            legacy_directory,
            saved: Mutex::new(saved),
        }
    }

    pub fn state(&self) -> State {
        let saved = self.saved.lock().unwrap();
        State {
            settings: saved.settings.clone(),
            initialized: saved.initialized,
            wallpaper_version: saved.wallpaper.as_ref().map(|_| saved.wallpaper_generation),
        }
    }

    pub fn polling_profile(&self) -> PollingProfile {
        self.saved
            .lock()
            .unwrap()
            .settings
            .telemetry
            .polling_profile
    }

    pub fn directory(&self) -> Option<&Path> {
        self.directory.as_deref()
    }

    pub fn update(
        &self,
        changes: Changes,
        apply: impl FnOnce(PollingProfile),
    ) -> io::Result<Settings> {
        let mut saved = self.saved.lock().unwrap();
        let mut settings = saved.settings.clone();
        changes.apply(&mut settings);
        if let Some(path) = &self.directory
            && (!saved.initialized || settings != saved.settings)
        {
            write_atomic(path, SETTINGS_FILE, &serde_json::to_vec_pretty(&settings)?)?;
        }
        saved.settings = settings.clone();
        saved.initialized = true;
        apply(settings.telemetry.polling_profile);
        Ok(settings)
    }

    pub fn legacy_changes(&self) -> io::Result<Changes> {
        #[derive(Default, Deserialize)]
        struct LegacyUi {
            layout: Option<Layout>,
            theme: Option<Theme>,
        }
        #[derive(Default, Deserialize)]
        struct LegacyApp {
            telemetry: Option<Telemetry>,
            directories: Option<Directories>,
        }
        let path = self.legacy_directory.as_ref().ok_or_else(|| {
            io::Error::other("CoreWatch's PowerShell preferences are unavailable.")
        })?;
        let ui: LegacyUi = read_json(&path.join("ui-settings.json"))?.unwrap_or_default();
        let app: LegacyApp = read_json(&path.join("settings.json"))?.unwrap_or_default();
        if ui.layout.is_none()
            && ui.theme.is_none()
            && app.telemetry.is_none()
            && app.directories.is_none()
        {
            return Err(io::Error::other(
                "No dashboard preferences were found in the PowerShell version.",
            ));
        }
        Ok(Changes {
            layout: ui.layout,
            theme: ui.theme,
            telemetry: app.telemetry,
            directories: app.directories,
            always_on_top: None,
            ..Changes::default()
        })
    }

    pub fn set_wallpaper(&self, bytes: Vec<u8>) -> io::Result<u64> {
        let wallpaper = Wallpaper::parse(bytes)?;
        let mut saved = self.saved.lock().unwrap();
        if let Some(path) = &self.directory {
            write_atomic(path, WALLPAPER_FILE, &wallpaper.bytes)?;
        }
        saved.wallpaper = Some(wallpaper);
        saved.wallpaper_generation += 1;
        Ok(saved.wallpaper_generation)
    }

    pub fn remove_wallpaper(&self) -> io::Result<()> {
        let mut saved = self.saved.lock().unwrap();
        if let Some(path) = &self.directory {
            match fs::remove_file(path.join(WALLPAPER_FILE)) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        saved.wallpaper = None;
        Ok(())
    }

    pub fn serve_wallpaper(&self, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let saved = self.saved.lock().unwrap();
        if request.method() == Method::GET
            && request.uri().path() == "/wallpaper"
            && let Some(wallpaper) = saved.wallpaper.as_ref()
        {
            return Response::builder()
                .header(header::CONTENT_TYPE, wallpaper.mime)
                .header(header::CACHE_CONTROL, "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(wallpaper.bytes.clone())
                .expect("build wallpaper response");
        }
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap()
    }
}

fn read_json<T: DeserializeOwned>(path: &Path) -> io::Result<Option<T>> {
    read_limited(path, MAX_SETTINGS_BYTES)?
        .map(|bytes| serde_json::from_slice(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes)))
        .transpose()
        .map_err(io::Error::from)
}

fn read_limited(path: &Path, limit: usize) -> io::Result<Option<Vec<u8>>> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::other(
            "The dashboard file exceeds the supported size.",
        ));
    }
    Ok(Some(bytes))
}

fn write_atomic(directory: &Path, filename: &str, bytes: &[u8]) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    let mut temp = tempfile::NamedTempFile::new_in(directory)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(directory.join(filename))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_powershell_aliases_without_overwriting_the_source() {
        let legacy = tempfile::tempdir().unwrap();
        let rust = tempfile::tempdir().unwrap();
        let ui = br##"{"layout":{"order":["network","identity","identity","old"],"wideCards":["network"],"hiddenCards":["infra"],"collapsedCards":["storage"],"hiddenMetrics":["hw-ram"]},"theme":{"bgApp":"#ABC","accent":"url(unsafe)"}}"##;
        let app = br#"{"telemetry":{"pollingProfile":"eco","temperatureUnit":"F"}}"#;
        fs::write(legacy.path().join("ui-settings.json"), ui).unwrap();
        fs::write(legacy.path().join("settings.json"), app).unwrap();
        let store = Store::open(Some(rust.path().into()), Some(legacy.path().into()));
        let next = store
            .update(store.legacy_changes().unwrap(), |_| {})
            .unwrap();
        assert_eq!(
            next.layout.order,
            [
                "network", "identity", "hardware", "storage", "infra", "console"
            ]
        );
        assert_eq!(next.layout.wide, ["network"]);
        assert_eq!(next.layout.hidden, ["infra"]);
        assert_eq!(next.layout.collapsed, ["storage"]);
        assert_eq!(next.layout.hidden_metrics, ["hw-ram"]);
        assert_eq!(
            next.telemetry,
            Telemetry {
                polling_profile: PollingProfile::Eco,
                temperature_unit: TemperatureUnit::F
            }
        );
        assert_eq!(next.theme.bg_app, "#aabbcc");
        assert_eq!(next.theme.accent, Theme::default().accent);
        assert_eq!(
            fs::read(legacy.path().join("ui-settings.json")).unwrap(),
            ui
        );
        assert_eq!(fs::read(legacy.path().join("settings.json")).unwrap(), app);
        assert_eq!(
            Store::open(Some(rust.path().into()), None).state().settings,
            next
        );
    }

    #[test]
    fn patches_preserve_other_preferences_and_report_the_chosen_cadence() {
        let path = tempfile::tempdir().unwrap();
        let store = Store::open(Some(path.path().into()), None);
        store
            .update(
                Changes {
                    always_on_top: Some(true),
                    ..Changes::default()
                },
                |_| {},
            )
            .unwrap();
        let settings = store
            .update(
                Changes {
                    telemetry: Some(Telemetry {
                        polling_profile: PollingProfile::Fast,
                        temperature_unit: TemperatureUnit::C,
                    }),
                    ..Changes::default()
                },
                |profile| {
                    assert_eq!(profile.fast_interval(), Duration::from_millis(250));
                    assert_eq!(profile.details_interval(), Duration::from_millis(1500));
                },
            )
            .unwrap();
        assert!(settings.always_on_top);
        assert!(
            Store::open(Some(path.path().into()), None)
                .state()
                .settings
                .always_on_top
        );
    }

    #[test]
    fn wallpaper_route_serves_the_selected_image_at_one_path() {
        let path = tempfile::tempdir().unwrap();
        let store = Store::open(Some(path.path().into()), None);
        assert!(store.set_wallpaper(b"<svg></svg>".to_vec()).is_err());
        let bytes = b"\x89PNG\r\n\x1a\nbinary image data".to_vec();
        store.set_wallpaper(bytes.clone()).unwrap();
        let store = Store::open(Some(path.path().into()), None);
        let request = |path| Request::builder().uri(path).body(Vec::new()).unwrap();
        let response = store.serve_wallpaper(&request("/wallpaper?v=1"));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(response.body(), &bytes);
        assert_eq!(
            store
                .serve_wallpaper(&request("/dashboard-preferences.json"))
                .status(),
            StatusCode::NOT_FOUND
        );
        store.remove_wallpaper().unwrap();
        assert_eq!(
            store.serve_wallpaper(&request("/wallpaper")).status(),
            StatusCode::NOT_FOUND
        );
        assert!(
            Store::open(Some(path.path().into()), None)
                .state()
                .wallpaper_version
                .is_none()
        );
    }
}
