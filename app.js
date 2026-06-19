let config = {};
let bgAnimationFrame = null;
let visualizerAnimationFrame = null;
let particlesAnimationFrame = null;
let audioContext = null;
let analyser = null;
let audioPlaying = false;
let wasAudioPlaying = false;
const githubUsername = "Piotrunius";
const API_ENDPOINTS = {
  github: "https://github-api.piotrunius.workers.dev/",
  roblox: "https://roblox-api.piotrunius.workers.dev/",
  steam: "https://steam-api.piotrunius.workers.dev/",
  discord: "https://discord-api.piotrunius.workers.dev",
  spotify: "https://spotify-api.piotrunius.workers.dev",
};

const logPerf = (...args) => console.log("[perf]", ...args);

const githubCache = {
  data: null,
  ts: 0,
};

const GITHUB_CACHE_MS = 60_000;

// Toast notification system
const ToastManager = {
  container: null,
  init() {
    this.container = document.getElementById("toast-container");
  },
  show(message, type = "info", duration = 5000) {
    if (!this.container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    const icons = {
      success: "fa-check-circle",
      error: "fa-exclamation-circle",
      info: "fa-info-circle",
    };

    toast.innerHTML = `
            <i class="fas ${icons[type] || icons.info} toast-icon"></i>
            <div class="toast-message">${message}</div>
        `;

    this.container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, duration);
  },
  success(message) {
    this.show(message, "success");
  },
  error(message) {
    this.show(message, "error");
  },
  info(message) {
    this.show(message, "info");
  },
};

// Auto detect dark mode preference
function initThemeDetection() {
  const savedTheme = localStorage.getItem("theme");
  if (!savedTheme) {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    if (!prefersDark) {
      document.body.classList.add("light-mode");
    }
  }

  // Listen for system theme changes
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      if (!localStorage.getItem("theme")) {
        if (e.matches) {
          document.body.classList.remove("light-mode");
        } else {
          document.body.classList.add("light-mode");
        }
      }
    });
}

// Enhanced fetch with retry logic and exponential backoff
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function fetchApiJson(url, fallback, label) {
  try {
    const resp = await fetchWithRetry(url, { cache: "no-store" }, 2);
    return await resp.json();
  } catch (e) {
    console.warn(`${label} error:`, e.message);
    ToastManager.error(`Failed to load ${label.toLowerCase()}`);
    return fallback;
  }
}

async function getGitHubData(force = false) {
  const now = Date.now();
  if (!force && githubCache.data && now - githubCache.ts < GITHUB_CACHE_MS) {
    return githubCache.data;
  }
  const fallback = {
    summary: { projects: 0, starredCount: 0, gistsCount: 0, commits: 0 },
    recentCommits: [],
    starred: [],
    projects: [],
    lastUpdate: new Date().toISOString(),
  };
  const data = await fetchApiJson(API_ENDPOINTS.github, fallback, "GitHub API");

  // Check for Privacy Mode - don't cache privacy mode responses
  if (data.privacyMode) {
    return data;
  }

  githubCache.data = data;
  githubCache.ts = now;
  return data;
}

const deviceCapabilities = {
  isLowEnd: false,
  isMobile: false,
  supportsWebGL: false,
  memoryLimit: Infinity,
  connectionSpeed: "fast",
};

const PARTICLE_COUNTS = {
  LOW_END: 40,
  MOBILE: 60,
  DESKTOP: 120,
};

function initPerformanceMonitoring() {
  if (!window.performance || !window.PerformanceObserver) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "measure" && entry.duration > 50) {
          console.warn(
            "Long task detected:",
            entry.name,
            `${entry.duration.toFixed(2)}ms`,
          );
        }
      }
    });

    observer.observe({ entryTypes: ["measure"] });

    window.addEventListener("load", () => {
      setTimeout(() => {
        const perfData = performance.getEntriesByType("navigation")[0];
        if (perfData) {
          logPerf("metrics", {
            "DOM Content Loaded": `${(perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart).toFixed(2)}ms`,
            "Load Complete": `${(perfData.loadEventEnd - perfData.loadEventStart).toFixed(2)}ms`,
            "Total Load Time": `${(perfData.loadEventEnd - perfData.fetchStart).toFixed(2)}ms`,
          });
        }
      }, 0);
    });
  } catch (e) {
    console.warn("Performance monitoring not available:", e.message);
  }
}

function detectDeviceCapabilities() {
  deviceCapabilities.isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    ) || window.innerWidth <= 768;

  const cores = navigator.hardwareConcurrency || 2;

  const memory = navigator.deviceMemory || 4; // fallback
  deviceCapabilities.memoryLimit = memory;

  const connection =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection;
  if (connection) {
    const effectiveType = connection.effectiveType || "4g";
    deviceCapabilities.connectionSpeed = effectiveType;
  }

  try {
    const canvas = document.createElement("canvas");
    deviceCapabilities.supportsWebGL = !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch (e) {
    deviceCapabilities.supportsWebGL = false;
  }

  // TODO: tune thresholds if needed
  deviceCapabilities.isLowEnd =
    cores <= 2 ||
    memory <= 2 ||
    (connection &&
      ["slow-2g", "2g", "3g"].includes(connection.effectiveType)) ||
    (deviceCapabilities.isMobile && memory <= 4);

  logPerf("caps", deviceCapabilities);
  return deviceCapabilities;
}

function applyPerformanceOptimizations() {
  const caps = deviceCapabilities;

  if (caps.isLowEnd) {
    logPerf("low-end, applying optimizations");

    document.body.classList.add("low-performance");

    const style = document.createElement("style");
    style.id = "perf-optimizations";
    style.textContent = `
            .low-performance .bg-layer::before,
            .low-performance .bg-layer::after {
                animation: none;
                opacity: 0.2;
            }
            .low-performance .glass-card {
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                will-change: auto;
            }
            .low-performance .avatar {
                animation: none;
            }
            .low-performance .avatar-ring {
                animation: none;
            }
            .low-performance .stat-card i {
                animation: none;
            }
            .low-performance .social-link i {
                animation: none;
            }
            .low-performance * {
                transition-duration: 0.15s;
            }
        `;
    document.head.appendChild(style);
  }

  if (caps.connectionSpeed === "slow-2g" || caps.connectionSpeed === "2g") {
    logPerf("slow connection, deferring heavy resources");
  }
}

// Setup & gear data
const setupData = {
  pc: [
    {
      icon: "microchip",
      label: "CPU",
      value: "Intel Core i5-13400F",
      url: "https://www.google.com/search?q=Intel+Core+i5-13400F",
      specs: ["10C/16T", "4.6GHz"],
    },
    {
      icon: "video",
      label: "GPU",
      value: "MSI GeForce RTX 4060 Ti",
      url: "https://www.google.com/search?q=MSI+GeForce+RTX+4060+Ti+16GB",
      specs: ["16GB GDDR6", "3rd Gen RT"],
    },
    {
      icon: "network-wired",
      label: "Motherboard",
      value: "Gigabyte B760 GAMING X DDR4",
      url: "https://www.google.com/search?q=Gigabyte+B760+GAMING+X+DDR4",
      specs: ["LGA 1700", "ATX"],
    },
    {
      icon: "memory",
      label: "RAM",
      value: "Kingston Fury Beast RGB",
      url: "https://www.google.com/search?q=Kingston+Fury+Beast+RGB+DDR4",
      specs: ["32GB", "DDR4", "3200MHz"],
    },
    {
      icon: "hard-drive",
      label: "Primary Storage",
      value: "Samsung 980 NVMe",
      url: "https://www.google.com/search?q=Samsung+980+NVMe+SSD+1TB",
      specs: ["1TB", "SSD", "NVMe M.2"],
    },
    {
      icon: "hard-drive",
      label: "Secondary Storage",
      value: "Seagate Barracuda",
      url: "https://www.google.com/search?q=Seagate+Barracuda+2TB+HDD",
      specs: ["2TB", "HDD"],
    },
    {
      icon: "bolt",
      label: "PSU",
      value: "Endorfy Vero L5 Bronze",
      url: "https://www.google.com/search?q=Endorfy+Vero+L5+Bronze+700W",
      specs: ["700W", "80+ Bronze"],
    },
  ],
  gear: [
    {
      icon: "display",
      label: "Primary Display",
      value: "AOC C27G2Z3/BK",
      url: "https://www.google.com/search?q=AOC+C27G2Z3/BK+280Hz",
      specs: ["280Hz", '27" Curved'],
    },
    {
      icon: "display",
      label: "Secondary Display",
      value: "AOC C27G2ZE",
      url: "https://www.google.com/search?q=AOC+C27G2ZE+240Hz",
      specs: ["240Hz", '27" Curved'],
    },
    {
      icon: "keyboard",
      label: "Keyboard",
      value: "Dark Project Terra Nova",
      url: "https://www.google.com/search?q=Dark+Project+Terra+Nova",
      specs: ["75%", "Wireless"],
    },
    {
      icon: "mouse",
      label: "Mouse",
      value: "Dark Project Novus",
      url: "https://www.google.com/search?q=Dark+Project+Novus",
      specs: ["~55g", "Wireless"],
    },
    {
      icon: "headset",
      label: "Headphones",
      value: "HyperX Cloud III",
      url: "https://www.google.com/search?q=HyperX+Cloud+III+Wireless",
      specs: ["53mm Drivers", "Wireless"],
    },
    {
      icon: "microphone",
      label: "Microphone",
      value: "Fifine AM8 RGB",
      url: "https://www.google.com/search?q=Fifine+AM8+RGB",
      specs: ["Dynamic", "USB/XLR"],
    },
    {
      icon: "vr-cardboard",
      label: "VR",
      value: "Meta Quest 3",
      url: "https://www.google.com/search?q=Meta+Quest+3+128GB",
      specs: ["128GB", "120Hz"],
    },
  ],
};

function getDefaultConfig() {
  return {
    profile: {
      name: "Piotrunius",
      bio: "Developer & tech enthusiast from Poland.",
      avatar: "assets/pfp.png",
    },
    socials: [
      {
        label: "GitHub",
        svg: "assets/github.svg",
        url: "https://github.com/Piotrunius",
        color: "#ffffff",
      },
      {
        label: "Spotify",
        svg: "assets/spotify.svg",
        url: "https://stats.fm/piotrunius",
        color: "#1DB954",
      },
      {
        label: "Steam",
        svg: "assets/steam.svg",
        url: "https://steamcommunity.com/id/piotrunius",
        color: "#00adee",
      },
      {
        label: "AniList",
        svg: "assets/anilist.svg",
        url: "https://anilist.co/user/Piotrunius",
        color: "#1663ffff",
      },
      {
        label: "Roblox",
        svg: "assets/roblox.svg",
        url: "https://www.roblox.com/users/962249141/profile",
        color: "#EF3340",
      },
      {
        label: "Ko-Fi",
        svg: "assets/ko-fi.svg",
        url: "https://ko-fi.com/piotrunius",
        color: "#6F4E37",
      },
    ],
    music: {
      title: "Smoking Alone",
      artist: "BackDrop",
      url: "https://pixabay.com/music/ambient-dark-ambient-background-music-smoking-alone-328352/",
    },
    audio: {
      src: "assets/audio.mp3",
      volume: 0.1,
    },
  };
}

async function loadConfig() {
  config = getDefaultConfig();
  return config;
}

// --- INIT HELPERS ---
function initProfile() {
  const avatar = document.getElementById("avatar");
  const nameEl = document.getElementById("profile-name");
  const bioEl = document.getElementById("profile-bio");
  if (avatar) avatar.src = config.profile?.avatar || "assets/pfp.png";
  if (nameEl) nameEl.textContent = config.profile?.name || "Piotrunius";
  if (bioEl) bioEl.textContent = config.profile?.bio || "Bio";
}

function initSocials() {
  const container = document.getElementById("socials-container");
  if (!container) return;
  container.innerHTML = "";
  const socials = config.socials || [];
  socials.forEach((s, index) => {
    const a = document.createElement("a");
    a.className = "social-link";
    a.href = s.url || "#";
    a.target = "_blank";
    a.rel = "noreferrer";
    a.style.setProperty("--social-color", s.color || "#00ff88");
    a.style.animationDelay = `${index * 0.05}s`;
    const iconHtml = s.svg
      ? `<span class="social-custom-svg" style="--svg-url: url('${s.svg}')"></span>`
      : `<i class="${
          ["github", "discord", "spotify", "steam", "twitch"].includes(
            (s.icon || "").toLowerCase(),
          )
            ? "fa-brands"
            : "fas"
        } fa-${s.icon || "link"}"></i>`;

    a.innerHTML = `
            ${iconHtml}
            <span>${s.label}</span>
        `;
    // Track social link clicks
    a.addEventListener("click", () => {
      if (window.umami) {
        window.umami.track("Social Link Clicked", { platform: s.label });
      }
    });
    container.appendChild(a);
  });
}

function initMusicMeta() {
  const titleEl = document.getElementById("music-title");
  const artistEl = document.getElementById("music-artist");
  if (titleEl) {
    titleEl.textContent = config.music?.title || "Unknown";
    titleEl.href = config.music?.url || "#";
  }
  if (artistEl) artistEl.textContent = config.music?.artist || "";
}

// --- CORE FUNCTION: Render GitHub Activity ---
async function refreshGitHubStats() {
  const projectsEl = document.getElementById("stat-projects");
  const commitsEl = document.getElementById("stat-commits");
  const gistsEl = document.getElementById("stat-gists");
  const lastUpdateEl = document.getElementById("stats-last-update");
  const activityStarsEl = document.getElementById("starred-list");
  const activityCommitsEl = document.getElementById("commits-list");

  const stats = await getGitHubData();

  // Check for Privacy Mode
  if (stats.privacyMode) {
    const privacyMessage =
      '<div class="activity-item privacy-placeholder"><i class="fas fa-lock"></i> <span>Privacy Mode Active</span></div>';
    if (activityStarsEl) activityStarsEl.innerHTML = privacyMessage;
    if (activityCommitsEl) activityCommitsEl.innerHTML = privacyMessage;
    if (projectsEl) projectsEl.textContent = "?";
    if (commitsEl) commitsEl.textContent = "?";
    if (gistsEl) gistsEl.textContent = "?";
    if (lastUpdateEl) lastUpdateEl.textContent = "Privacy Mode Active";
    return;
  }

  const summary = stats.summary || {};
  const starred = Array.isArray(stats.starred) ? stats.starred : [];
  const commits = Array.isArray(stats.recentCommits) ? stats.recentCommits : [];
  const totalProjects = Array.isArray(stats.projects)
    ? stats.projects.length
    : undefined;
  const projectsCount = totalProjects ?? summary.projects ?? 0;
  const commitsCount = summary.commits ?? commits.length;
  // Use total stars received (provided by proxy as "starsReceived") instead of gists count
  const starsReceived =
    // prefer a top-level value from the API proxy, fall back to common summary fields
    stats.starsReceived ?? summary.starsReceived ?? summary.starredCount ?? 0;

  // Reset to 0 and animate
  if (projectsEl) {
    projectsEl.textContent = "0";
    animateCounter("stat-projects", projectsCount || 0, 1500);
  }
  if (gistsEl) {
    // The "gists" stat card is repurposed to show total stars received
    gistsEl.textContent = "0";
    animateCounter("stat-gists", starsReceived || 0, 1500);
  }
  if (commitsEl) {
    commitsEl.textContent = "0";
    animateCounter("stat-commits", commitsCount || 0, 1500);
  }
  if (lastUpdateEl) {
    const lastUpdate = stats.lastUpdate || new Date().toISOString();
    lastUpdateEl.textContent = `Last updated: ${formatPLDateTime(lastUpdate)}`;
  }

  // Use DocumentFragment for better performance
  if (activityStarsEl && starred.length > 0) {
    const fragment = document.createDocumentFragment();
    starred.slice(0, 20).forEach((star, index) => {
      const item = document.createElement("div");
      item.className = "activity-item";
      item.style.animationDelay = `${index * 0.05}s`;
      item.innerHTML = `
                <div class="activity-header">
                    <a href="${star.url || "#"}" class="activity-link" target="_blank" rel="noreferrer">${star.name || "Unknown"}</a>
                    <div class="meta-badge" title="Stars"><i class="fas fa-star"></i> ${star.stars || 0}</div>
                </div>
                <div class="activity-desc">${star.description || "No description."}</div>
                <div class="activity-meta-row">
                    <div class="meta-badge"><i class="fas fa-user"></i> ${star.owner || "Unknown"}</div>
                    <div class="meta-badge"><i class="fas fa-code"></i> ${star.language || "Unknown"}</div>
                </div>
            `;
      fragment.appendChild(item);
    });
    activityStarsEl.innerHTML = "";
    activityStarsEl.appendChild(fragment);
  } else if (activityStarsEl) {
    activityStarsEl.innerHTML =
      '<div class="activity-item">No recent stars</div>';
  }

  // Display recent commits from GitHub Worker API
  if (activityCommitsEl && commits.length > 0) {
    const fragment = document.createDocumentFragment();
    commits
      .slice(0, 50) // Show up to 50 commits
      .forEach((commit, index) => {
        const item = document.createElement("div");
        item.className = "activity-item";
        item.style.animationDelay = `${index * 0.05}s`;

        const message = commit.message?.split("\n")[0] || "No message";
        const author = commit.author || githubUsername;
        const date = commit.date || new Date().toISOString();
        const repoName = commit.repo || "Unknown";
        const repoUrl = `https://github.com/${githubUsername}/${repoName}`;
        const commitUrl = commit.url || "#";

        item.innerHTML = `
                    <div class="activity-header">
                        <a href="${commitUrl}" class="activity-link" target="_blank" rel="noreferrer">${message}</a>
                    </div>
                    <div class="activity-desc"><a href="${repoUrl}" target="_blank" rel="noreferrer" style="color: var(--primary); text-decoration: none;">${repoName}</a></div>
                    <div class="activity-meta-row">
                        <div class="meta-badge"><i class="fas fa-user-circle"></i> ${author}</div>
                        <span class="meta-date">${formatPLDateTime(date, true)}</span>
                    </div>
                `;
        fragment.appendChild(item);
      });
    activityCommitsEl.innerHTML = "";
    activityCommitsEl.appendChild(fragment);
  } else if (activityCommitsEl) {
    activityCommitsEl.innerHTML =
      '<div class="activity-item">No recent commits</div>';
  }
}

// Animate number counting for stats
function animateCounter(elementId, targetValue, duration = 1500) {
  const element = document.getElementById(elementId);
  if (!element) return;

  const startValue = 0;
  const startTime = Date.now();

  const updateValue = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Easing function for smooth animation
    const easeOutQuad = (progress) => 1 - (1 - progress) * (1 - progress);
    const easedProgress = easeOutQuad(progress);

    const currentValue = Math.floor(
      startValue + (targetValue - startValue) * easedProgress,
    );
    element.textContent = currentValue;

    if (progress < 1) {
      requestAnimationFrame(updateValue);
    } else {
      element.textContent = targetValue;
    }
  };

  requestAnimationFrame(updateValue);
}

// Helper to hide loading spinner with smooth fade
function hideLoadingSpinner(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const spinner = panel.querySelector(".status-loading-spinner");
  if (spinner) {
    spinner.classList.add("hidden");
  }
}

// --- CORE FUNCTION: Render Steam Status ---
async function refreshSteamStatus() {
  const steamPanel = document.getElementById("steam-status-panel");
  if (!steamPanel) return;

  const fallback = { steam: { personastate: 0, gameextrainfo: null } };
  const stats = await fetchApiJson(API_ENDPOINTS.steam, fallback, "Steam API");

  // Check for Privacy Mode
  if (stats.privacyMode) {
    const statusText = document.getElementById("steam-status-text");
    const gameInfo = document.getElementById("steam-game-info");
    const memberSince = document.getElementById("steam-member-since");
    const gameCount = document.getElementById("steam-game-count");
    const extraInfo = document.querySelector(".steam-extra-info");
    const steamUsernameEl = document.querySelector(".steam-username");
    const steamPfp = document.getElementById("steam-pfp");
    const steamDot = document.getElementById("steam-dot");
    const avatarWrapper = document.querySelector(".steam-avatar-wrapper");

    if (statusText) statusText.textContent = "Privacy Mode";
    if (gameInfo) gameInfo.style.display = "none";
    if (memberSince) memberSince.style.display = "none";
    if (gameCount) gameCount.style.display = "none";
    if (extraInfo) extraInfo.style.display = "none";
    if (steamUsernameEl) steamUsernameEl.textContent = "Hidden";
    if (steamPfp) steamPfp.style.display = "none";
    if (steamDot) steamDot.style.display = "none";

    // Add lock icon to avatar wrapper
    if (avatarWrapper) {
      const lockIcon = document.createElement("i");
      lockIcon.className = "fas fa-lock";
      lockIcon.style.fontSize = "2rem";
      lockIcon.style.color = "var(--primary)";
      lockIcon.style.position = "absolute";
      lockIcon.style.top = "50%";
      lockIcon.style.left = "50%";
      lockIcon.style.transform = "translate(-50%, -50%)";
      avatarWrapper.style.position = "relative";
      avatarWrapper.innerHTML = "";
      avatarWrapper.appendChild(lockIcon);
    }

    return;
  }
  const s = stats.steam || stats || {};
  const statusText = document.getElementById("steam-status-text");
  const gameInfo = document.getElementById("steam-game-info");
  const dotContainer = document.getElementById("steam-dot")?.parentElement;
  const steamPfp = document.getElementById("steam-pfp");

  // Validate and sanitize Steam avatar URL
  if (s.avatar && steamPfp) {
    const avatarUrl = s.avatar;
    // Validate that URL is from Steam CDN
    if (
      avatarUrl.startsWith("https://avatars.akamai.steamstatic.com/") ||
      avatarUrl.startsWith("https://avatars.steamstatic.com/") ||
      avatarUrl.startsWith("https://steamcdn-a.akamaihd.net/")
    ) {
      steamPfp.src = avatarUrl;
      steamPfp.onerror = () => {
        steamPfp.src = "assets/pfp.png";
      };
    } else {
      console.warn("Invalid Steam avatar URL detected:", avatarUrl);
      steamPfp.src = "assets/pfp.png";
    }
  }

  const memberSince = document.getElementById("steam-member-since");
  const gameCount = document.getElementById("steam-game-count");
  const extraInfo = document.querySelector(".steam-extra-info");

  if (memberSince) {
    if (s.timecreated) {
      memberSince.textContent = `Since ${new Date(s.timecreated * 1000).getFullYear()}`;
      memberSince.style.display = "";
    } else {
      memberSince.textContent = "";
      memberSince.style.display = "none";
    }
  }
  if (gameCount) {
    if (s.game_count !== undefined) {
      gameCount.textContent = `${s.game_count} Games`;
      gameCount.style.display = "";
    } else {
      gameCount.textContent = "";
      gameCount.style.display = "none";
    }
  }
  if (extraInfo) {
    const hasMember = memberSince && memberSince.textContent.trim().length > 0;
    const hasGames = gameCount && gameCount.textContent.trim().length > 0;
    extraInfo.style.display = hasMember || hasGames ? "flex" : "none";
  }

  if (!dotContainer) return;

  dotContainer.className = "steam-avatar-wrapper";
  const gameName = s.gameextrainfo || s.game || s.gameName || null;
  const personaState =
    typeof s.personastate === "number"
      ? s.personastate
      : typeof s.state === "number"
        ? s.state
        : typeof s.status === "number"
          ? s.status
          : s.online
            ? 1
            : 0;

  if (gameName) {
    dotContainer.classList.add("in-game");
    if (statusText) statusText.textContent = "In-game";
    if (gameInfo) {
      gameInfo.textContent = `Playing: ${gameName}`;
      gameInfo.style.color = "#43b581";
      gameInfo.style.display = "block";
    }
  } else {
    if (gameInfo) gameInfo.style.display = "none";
    // Map personastate values properly:
    // 0 = Offline, 1 = Online, 2 = Busy, 3 = Away, 4 = Snooze, 5 = Looking to trade, 6 = Looking to play
    switch (personaState) {
      case 1:
        dotContainer.classList.add("online");
        if (statusText) statusText.textContent = "Online";
        break;
      case 2:
        dotContainer.classList.add("busy");
        if (statusText) statusText.textContent = "Busy";
        break;
      case 3:
      case 4:
        dotContainer.classList.add("away");
        if (statusText) statusText.textContent = "Away";
        break;
      case 5:
      case 6:
        dotContainer.classList.add("online");
        if (statusText) statusText.textContent = "Online";
        break;
      default:
        dotContainer.classList.add("offline");
        if (statusText) statusText.textContent = "Offline";
    }
  }

  // Hide loading spinner
  hideLoadingSpinner("steam-status-panel");
}

// --- DISCORD STATUS ---
async function refreshDiscordStatus() {
  const discordDot = document.getElementById("discord-dot");
  const discordStatus = document.getElementById("discord-status-text");
  const discordActivityInfo = document.getElementById("discord-activity-info");
  const discordAvatarWrapper = document.querySelector(
    ".discord-avatar-wrapper",
  );
  const discordUsernameEl = document.querySelector(".discord-username");
  const discordPanel = document.getElementById("discord-status-panel");

  try {
    const response = await fetch(API_ENDPOINTS.discord);
    if (response.ok) {
      const data = await response.json();
      console.log("Discord API response:", data);

      // Check for Privacy Mode
      if (data.privacyMode) {
        if (discordStatus) discordStatus.textContent = "Privacy Mode";
        if (discordUsernameEl) discordUsernameEl.textContent = "Hidden";
        if (discordActivityInfo) discordActivityInfo.style.display = "none";

        // Replace avatar with lock icon and hide dot
        if (discordAvatarWrapper) {
          discordAvatarWrapper.className = "discord-avatar-wrapper offline";
          const avatarImg = discordAvatarWrapper.querySelector("img");
          if (avatarImg) {
            avatarImg.style.display = "none";
          }
          const dotEl = discordAvatarWrapper.querySelector(".status-dot");
          if (dotEl) dotEl.style.display = "none";

          // Add lock icon
          const lockIcon = document.createElement("i");
          lockIcon.className = "fas fa-lock";
          lockIcon.style.fontSize = "2rem";
          lockIcon.style.color = "var(--primary)";
          lockIcon.style.position = "absolute";
          lockIcon.style.top = "50%";
          lockIcon.style.left = "50%";
          lockIcon.style.transform = "translate(-50%, -50%)";
          discordAvatarWrapper.style.position = "relative";
          discordAvatarWrapper.appendChild(lockIcon);
        }

        if (discordPanel) discordPanel.style.display = "flex";
        return;
      }

      const user = data.user;
      const presence = data.presence;
      const activities = data.activities || [];

      // Update status
      const statusMap = {
        online: "Online",
        idle: "Idle",
        dnd: "Do Not Disturb",
        offline: "Offline",
      };

      const statusText = statusMap[presence.status] || presence.status;
      const statusClass = presence.status || "offline";
      const username = user.username || "Piotrunius";

      if (discordStatus) {
        discordStatus.textContent = statusText;
      }

      if (discordUsernameEl) {
        discordUsernameEl.textContent = username;
      }

      if (discordAvatarWrapper) {
        discordAvatarWrapper.className = `discord-avatar-wrapper ${statusClass}`;
        const avatarImg = discordAvatarWrapper.querySelector("img");
        if (avatarImg && user.avatar) {
          avatarImg.src = user.avatar;
        }
      }

      if (discordDot) {
        discordDot.className = `status-dot ${statusClass}`;
      }

      // Update activity info
      if (discordActivityInfo) {
        if (activities && activities.length > 0) {
          const activity = activities.find((a) => a.type !== 4); // Exclude custom status
          if (activity) {
            const activityTypeMap = {
              0: "Playing",
              1: "Streaming",
              2: "Listening",
              3: "Watching",
              5: "Competing",
            };

            const activityType = activityTypeMap[activity.type] || "Activity";
            discordActivityInfo.textContent = `${activityType}: ${activity.name}`;
            discordActivityInfo.style.display = "block";
          } else {
            discordActivityInfo.style.display = "none";
          }
        } else {
          discordActivityInfo.style.display = "none";
        }
      }
    }
    // Show panel after data is loaded
    if (discordPanel) discordPanel.style.display = "flex";
  } catch (e) {
    console.warn("Error fetching Discord status from Lanyard:", e.message);
    // Fallback
    if (discordStatus) discordStatus.textContent = "Offline";
    if (discordAvatarWrapper)
      discordAvatarWrapper.className = "discord-avatar-wrapper offline";
    if (discordDot) discordDot.className = "status-dot";
  }
}

// --- ROBLOX STATUS ---
async function refreshRobloxStatus() {
  const robloxPanel = document.getElementById("roblox-status-panel");
  if (!robloxPanel) return;

  const fallback = { status: "Offline", game: null };
  const data = await fetchApiJson(API_ENDPOINTS.roblox, fallback, "Roblox API");

  // Check for Privacy Mode
  if (data.privacyMode) {
    const statusText = document.getElementById("roblox-status-text");
    const gameInfo = document.getElementById("roblox-game-info");
    const avatarWrapper = document.querySelector(".roblox-avatar-wrapper");
    const usernameEl = document.querySelector(".roblox-username");
    const robloxPfp = document.getElementById("roblox-pfp");

    if (statusText) statusText.textContent = "Privacy Mode";
    if (usernameEl) usernameEl.textContent = "Hidden";
    if (gameInfo) gameInfo.style.display = "none";
    if (robloxPfp) {
      robloxPfp.style.display = "none";
    }
    if (avatarWrapper) {
      avatarWrapper.className = "roblox-avatar-wrapper offline";
      const lockIcon = document.createElement("i");
      lockIcon.className = "fas fa-lock";
      lockIcon.style.fontSize = "2rem";
      lockIcon.style.color = "var(--primary)";
      lockIcon.style.position = "absolute";
      lockIcon.style.top = "50%";
      lockIcon.style.left = "50%";
      lockIcon.style.transform = "translate(-50%, -50%)";
      avatarWrapper.style.position = "relative";
      avatarWrapper.innerHTML = "";
      avatarWrapper.appendChild(lockIcon);
    }
    robloxPanel.style.display = "flex";
    return;
  }

  const statusRaw =
    data.status ??
    data.state ??
    data.presence ??
    data.presenceType ??
    "Offline";
  const statusMap = {
    0: "Offline",
    1: "Online",
    2: "In Game",
    3: "In Studio",
  };
  const status =
    typeof statusRaw === "number"
      ? statusMap[statusRaw] || "Offline"
      : typeof statusRaw === "string"
        ? statusRaw
        : String(statusRaw || "Offline");
  const statusLower = status.toLowerCase();
  const username =
    typeof (data.username || data.name) === "string"
      ? (data.username || data.name).trim()
      : null;
  const game = data.game || data.gameName || data.place || null;
  const avatar = data.avatarUrl || data.avatar || data.thumbnail || null;

  const statusText = document.getElementById("roblox-status-text");
  const gameInfo = document.getElementById("roblox-game-info");
  const avatarWrapper = document.querySelector(".roblox-avatar-wrapper");
  const usernameEl = document.querySelector(".roblox-username");
  const robloxPfp = document.getElementById("roblox-pfp");

  if (statusText) statusText.textContent = status;
  if (usernameEl && username) usernameEl.textContent = username;

  if (robloxPfp && typeof avatar === "string" && avatar.trim()) {
    const prevSrc = robloxPfp.src;
    robloxPfp.onerror = () => {
      robloxPfp.src = prevSrc;
      robloxPfp.onerror = null;
    };
    robloxPfp.src = avatar;
  }

  if (avatarWrapper) {
    avatarWrapper.className = "roblox-avatar-wrapper";
    if (statusLower.includes("in game")) {
      avatarWrapper.classList.add("in-game");
    } else if (statusLower.includes("in studio")) {
      avatarWrapper.classList.add("busy");
    } else if (statusLower.includes("online")) {
      avatarWrapper.classList.add("online");
    } else if (statusLower.includes("away")) {
      avatarWrapper.classList.add("away");
    } else {
      avatarWrapper.classList.add("offline");
    }
  }

  if (gameInfo) {
    if (statusLower.includes("in game") && game) {
      gameInfo.textContent = `Playing: ${game}`;
      gameInfo.style.display = "block";
    } else if (statusLower.includes("in studio")) {
      gameInfo.textContent = "Creating games in Studio";
      gameInfo.style.display = "block";
    } else {
      gameInfo.style.display = "none";
    }
  }
  // Show panel after data is loaded
  robloxPanel.style.display = "flex";
}

// --- CORE FUNCTION: Render Setup (Safe & Visible) ---
function initSetup() {
  const pcSpecs = document.getElementById("pc-specs");
  const setupSpecs = document.getElementById("setup-specs");

  // Helper to render lists
  const renderList = (container, items) => {
    if (!container) return;
    container.innerHTML = "";
    items.forEach((item, index) => {
      const el = document.createElement("a");
      el.className = "spec-item-v2";
      el.style.animationDelay = `${index * 0.05}s`;
      el.href = item.url || "#";
      el.target = "_blank";
      el.rel = "noreferrer";

      // Render tags if present
      let tagsHtml = "";
      if (item.specs && item.specs.length > 0) {
        tagsHtml = `<div class="spec-v2-tags">
          ${item.specs.map((s) => `<span class="spec-v2-tag">${s}</span>`).join("")}
        </div>`;
      }

      el.innerHTML = `
        <div class="spec-v2-icon">
          <i class="fas fa-${item.icon}"></i>
        </div>
        <div class="spec-v2-content">
          <div class="spec-v2-info">
            <span class="spec-v2-label">${item.label}</span>
            <span class="spec-v2-value">${item.value}</span>
          </div>
          ${tagsHtml}
        </div>
      `;
      container.appendChild(el);
    });
  };

  renderList(pcSpecs, setupData.pc);
  renderList(setupSpecs, setupData.gear);
}

// --- UTILS ---
function formatPLDateTime(dateInput, short = false) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");

  if (short) return `${day}.${month}.${year} ${hours}:${mins}`;
  return `${day}.${month}.${year}, ${hours}:${mins}`;
}

// --- AUDIO & VISUALIZER ---
function initControls() {
  const audioToggle = document.getElementById("audio-toggle");
  if (audioToggle) {
    audioToggle.addEventListener("click", toggleAudio);
  }
  const audio = document.getElementById("bg-audio");
  if (audio) {
    audio.addEventListener("play", () => {
      audioPlaying = true;
      updateAudioButton();
    });
    audio.addEventListener("pause", () => {
      audioPlaying = false;
      updateAudioButton();
    });
  }
}

function toggleAudio() {
  const audio = document.getElementById("bg-audio");
  if (!audio) return;
  if (config.audio?.src) audio.src = config.audio.src;
  audio.volume = config.audio?.volume || 0.4;

  if (!audioPlaying) {
    audio
      .play()
      .then(() => {
        audioPlaying = true;
        initAudioVisualizer();
        updateAudioButton();
      })
      .catch((err) => console.log("Audio play failed:", err));
  } else {
    audio.pause();
    audioPlaying = false;
    updateAudioButton();
  }
}

function updateAudioButton() {
  const btn = document.getElementById("audio-toggle");
  if (!btn) return;
  const icon = btn.querySelector("i");
  const label = btn.querySelector("span");
  if (icon) icon.className = audioPlaying ? "fas fa-pause" : "fas fa-play";
  if (label) label.textContent = audioPlaying ? "Pause" : "Play";
}

function initAudioVisualizer() {
  const audio = document.getElementById("bg-audio");
  const canvas = document.getElementById("visualizer");
  if (!audio || !canvas) return;

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    analyser.fftSize = 256;
  }

  const ctx = canvas.getContext("2d");
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  // Resize handling
  const resizeCanvas = () => {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  };
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Store the animate function to reuse it when resuming
  window.visualizerAnimate = function () {
    if (!audioPlaying || document.hidden) {
      cancelAnimationFrame(visualizerAnimationFrame);
      return;
    }
    visualizerAnimationFrame = requestAnimationFrame(window.visualizerAnimate);
    analyser.getByteFrequencyData(dataArray);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 1.5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height * 0.85;
      const gradient = ctx.createLinearGradient(
        0,
        canvas.height - barHeight,
        0,
        canvas.height,
      );
      gradient.addColorStop(0, "#00ff88");
      gradient.addColorStop(1, "rgba(0,255,136,0.1)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }
  };

  // Start animation if not already running
  window.visualizerAnimate();
}

function initParticles() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let width, height;
  let particles = [];

  const resize = () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  };
  window.addEventListener("resize", resize);
  resize();

  class Particle {
    constructor() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.vx = (Math.random() - 0.5) * 0.4;
      this.vy = (Math.random() - 0.5) * 0.4;
      this.size = Math.random() * 3 + 2; // Increased size (2-5px)
      this.color = `rgba(0, 255, 136, ${Math.random() * 0.3})`; // Slightly more opaque
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < 0) this.x = width;
      if (this.x > width) this.x = 0;
      if (this.y < 0) this.y = height;
      if (this.y > height) this.y = 0;
    }
    draw() {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Adaptive particle count based on device
  const particleCount = deviceCapabilities.isLowEnd
    ? PARTICLE_COUNTS.LOW_END
    : deviceCapabilities.isMobile
      ? PARTICLE_COUNTS.MOBILE
      : PARTICLE_COUNTS.DESKTOP;

  for (let i = 0; i < particleCount; i++) particles.push(new Particle());

  // Store animate function globally (or in a wider scope) to access it for visibility change
  window.particlesAnimate = function () {
    if (document.hidden) {
      cancelAnimationFrame(particlesAnimationFrame);
      return;
    }
    ctx.clearRect(0, 0, width, height);
    particles.forEach((p) => {
      p.update();
      p.draw();
    });
    particlesAnimationFrame = requestAnimationFrame(window.particlesAnimate);
  };

  // Only start particles if not low-end device
  if (!deviceCapabilities.isLowEnd) {
    window.particlesAnimate();
  } else {
    console.log("Particles disabled for low-end device");
  }
}

function initScrollReveal() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 },
  );

  const animatedElements = document.querySelectorAll(
    ".animate-fade-in, .animate-slide-up, .animate-slide-right, .animate-slide-left",
  );
  animatedElements.forEach((el) => observer.observe(el));
}

function initTypingEffect() {
  const bioEl = document.getElementById("profile-bio");
  if (!bioEl) return;
  const text = config.profile?.bio || bioEl.textContent;
  bioEl.textContent = "";
  bioEl.classList.add("typing-cursor");

  let i = 0;
  const type = () => {
    if (i < text.length) {
      bioEl.textContent += text.charAt(i);
      i++;
      setTimeout(type, 30 + Math.random() * 50);
    } else {
      setTimeout(() => bioEl.classList.remove("typing-cursor"), 1000);
    }
  };
  setTimeout(type, 500); // Initial delay
}

function initMouseEffects() {
  const cards = document.querySelectorAll(".glass-card");
  cards.forEach((card) => {
    card.addEventListener(
      "mouseenter",
      () => (card.style.transform = "translateY(-8px) scale(1.01)"),
    );
    card.addEventListener("mouseleave", () => (card.style.transform = ""));
  });
}

// --- VISIBILITY & PERFORMANCE OPTIMIZATION ---
function initVisibilityOptimization() {
  document.addEventListener("visibilitychange", () => {
    const audio = document.getElementById("bg-audio");

    if (document.hidden) {
      // PAGE HIDDEN: Freeze everything
      console.log("Page hidden: Freezing resources...");

      // 1. Pause Audio
      if (audioPlaying) {
        wasAudioPlaying = true;
        if (audio) audio.pause();
        // We keep audioPlaying = true logic visually, but pause underlying audio
        // to resume it correctly later without changing UI state
      } else {
        wasAudioPlaying = false;
      }

      // 2. Stop Visualizer Loop
      if (visualizerAnimationFrame) {
        cancelAnimationFrame(visualizerAnimationFrame);
      }

      // 3. Stop Particles Loop
      if (particlesAnimationFrame) {
        cancelAnimationFrame(particlesAnimationFrame);
      }
    } else {
      // PAGE VISIBLE: Resume
      console.log("Page visible: Resuming resources...");

      // 1. Resume Audio if it was playing
      if (wasAudioPlaying && audio) {
        audio.play().catch((e) => console.log("Resume play failed:", e));
      }

      // 2. Resume Visualizer if audio is playing
      if (audioPlaying && window.visualizerAnimate) {
        window.visualizerAnimate();
      }

      // 3. Resume Particles
      if (window.particlesAnimate) {
        window.particlesAnimate();
      }

      // 4. Refresh stats immediately on return
      refreshGitHubStats();
      refreshSteamStatus();
    }
  });
}

// --- SPOTIFY HUB LOGIC ---
let lastSpotifyData = null;
let spotifyPredictorInterval = null;

async function updateSpotifyStatus() {
  const container = document.getElementById("spotify-content");

  try {
    const response = await fetch(API_ENDPOINTS.spotify);
    const data = await response.json();
    console.log("Spotify API response:", data);

    // Check for Privacy Mode
    if (data.privacyMode) {
      renderSpotifyPrivacyMode(container);
      lastSpotifyData = null;
      if (spotifyPredictorInterval) {
        clearInterval(spotifyPredictorInterval);
        spotifyPredictorInterval = null;
      }
      return;
    }

    if (data && data.isPlaying) {
      const spotify = {
        song: data.title,
        artist: data.artist,
        album: data.album,
        album_art_url: data.albumArt,
        track_id: data.songUrl.split("/").pop(),
        timestamps: {
          start: Date.now() - data.progressMs,
          end: Date.now() - data.progressMs + data.durationMs,
        },
      };

      // Render initial or updated state
      renderSpotifyActive(container, spotify);

      // Auto-stop local audio on new track
      if (!lastSpotifyData || lastSpotifyData.track_id !== spotify.track_id) {
        const audio = document.getElementById("bg-audio");
        if (audio && !audio.paused) {
          audio.pause();
          audioPlaying = false;
          updateAudioButton();
        }
      }
      lastSpotifyData = spotify;

      // Start prediction loop if not running
      if (!spotifyPredictorInterval) {
        spotifyPredictorInterval = setInterval(predictSpotifyProgress, 1000);
      }
    } else {
      renderSpotifyEmpty(container);
      lastSpotifyData = null;
      if (spotifyPredictorInterval) {
        clearInterval(spotifyPredictorInterval);
        spotifyPredictorInterval = null;
      }
    }
  } catch (err) {
    console.error("Spotify status error:", err);
  }
}

function predictSpotifyProgress() {
  if (!lastSpotifyData) return;
  const container = document.getElementById("spotify-content");
  if (!container) return;
  renderSpotifyActive(container, lastSpotifyData);
}

function renderSpotifyActive(container, spotify) {
  const start = spotify.timestamps.start;
  const end = spotify.timestamps.end;
  const now = Date.now();
  const total = end - start;
  const elapsed = Math.min(Math.max(now - start, 0), total);
  const progress = (elapsed / total) * 100;

  const formatTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  };

  // Use a simplified render to avoid heavy DOM reconstruction every second
  const bar = container.querySelector(".spotify-progress-bar");
  const timeStart = container.querySelector(".spotify-time span:first-child");

  if (bar && timeStart && container.dataset.trackId === spotify.track_id) {
    bar.style.width = `${progress}%`;
    timeStart.textContent = formatTime(elapsed);
    return;
  }

  container.dataset.trackId = spotify.track_id;
  container.innerHTML = `
        <div class="spotify-active-layout">
            <div class="spotify-art-wrapper">
                <img src="${spotify.album_art_url}" alt="Album Art">
            </div>
            <div class="spotify-details">
                <div class="spotify-track-name">${spotify.song}</div>
                <div class="spotify-artist-name">${spotify.artist}</div>
                ${spotify.album && spotify.album !== spotify.song ? `<div class="spotify-album-name">${spotify.album}</div>` : ""}

                <div class="spotify-progress-container">
                    <div class="spotify-progress-bar" style="width: ${progress}%"></div>
                </div>
                <div class="spotify-time">
                    <span>${formatTime(elapsed)}</span>
                    <span>${formatTime(total)}</span>
                </div>
            </div>
            <div class="music-controls">
                <a href="https://open.spotify.com/track/${spotify.track_id}" target="_blank" rel="noreferrer" class="music-btn spotify-btn">
                    <i class="fa-brands fa-spotify"></i>
                    <span>Open in Spotify</span>
                </a>
            </div>
        </div>
    `;
  container.className = "spotify-content";
}

function renderSpotifyEmpty(container) {
  if (container.classList.contains("empty")) return;
  container.innerHTML = `
        <div class="spotify-placeholder">
            <i class="fas fa-headphones"></i>
            <span>Not listening right now</span>
        </div>
    `;
  container.className = "spotify-content empty";
  delete container.dataset.trackId;
}

function renderSpotifyPrivacyMode(container) {
  if (container.classList.contains("privacy")) return;
  container.innerHTML = `
        <div class="spotify-placeholder">
            <i class="fas fa-lock"></i>
            <span>Privacy Mode Active</span>
        </div>
    `;
  container.className = "spotify-content privacy";
  delete container.dataset.trackId;
}

// --- TIME & TIMEZONE SECTION ---
const MY_TIMEZONE = "Europe/Warsaw"; // Your timezone

// --- INIT ---
document.addEventListener("DOMContentLoaded", async () => {
  // Initialize performance monitoring
  initPerformanceMonitoring();

  // Register Service Worker for offline support
  if ("serviceWorker" in navigator && false) {
    // Disabled temporarily
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      console.log("Service Worker registered:", registration.scope);

      // Check for updates
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        newWorker.addEventListener("statechange", () => {
          if (
            newWorker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            console.log("New version available! Refresh to update.");
          }
        });
      });
    } catch (error) {
      console.warn("Service Worker registration failed:", error);
    }
  }

  // Detect device capabilities first
  detectDeviceCapabilities();
  applyPerformanceOptimizations();

  await loadConfig();
  initProfile();
  initSocials();
  initMusicMeta();
  initSetup();
  refreshGitHubStats();
  refreshSteamStatus();
  refreshDiscordStatus();
  refreshRobloxStatus();
  updateSpotifyStatus();
  initControls();

  // Initialize particles only after capability detection
  initParticles();

  initScrollReveal();
  initTypingEffect();
  initMouseEffects();
  initVisibilityOptimization();
  initWipNotice();
  updateCopyrightYear();

  // Auto-refresh stats with adaptive intervals
  const statsInterval = deviceCapabilities.isLowEnd ? 600000 : 300000; // 10 or 5 minutes
  const steamInterval = deviceCapabilities.isLowEnd ? 120000 : 60000; // 2 or 1 minute
  const spotifyInterval = deviceCapabilities.isLowEnd ? 45000 : 30000; // 45 or 30 seconds

  setInterval(refreshGitHubStats, statsInterval);
  setInterval(refreshSteamStatus, steamInterval);
  setInterval(refreshDiscordStatus, 15000); // Update Discord status every 15 seconds
  setInterval(refreshRobloxStatus, steamInterval);
  setInterval(updateSpotifyStatus, spotifyInterval);

  // Load projects
  loadProjects();
});

// --- PROJECTS SECTION ---
async function fetchGitHubRepos() {
  try {
    const data = await getGitHubData();

    // If Privacy Mode, return full data object to preserve privacyMode flag
    if (data.privacyMode) {
      return data;
    }

    const repos = data.projects || data.repos || data.repositories || [];
    if (!Array.isArray(repos)) return null;

    return repos
      .filter(
        (repo) =>
          ((!repo.isPrivate && !repo.private && !repo.fork) ||
            repo.name === "NexVid") &&
          repo.name !== "Offline-Casino" &&
          repo.name !== "AutoClicker-AntiAFK" &&
          repo.name !== "Piotrunius",
      )
      .sort(
        (a, b) =>
          new Date(b.updated_at || b.pushed_at || 0) -
          new Date(a.updated_at || a.pushed_at || 0),
      );
  } catch (error) {
    console.error("Error fetching GitHub repos:", error);
    return null;
  }
}

async function loadProjects() {
  const container = document.getElementById("projects-container");
  if (!container) return;

  try {
    // Fetch from GitHub Worker API
    const allRepos = await fetchGitHubRepos();
    if (!allRepos) {
      throw new Error("GitHub Worker API failed");
    }

    // Check for Privacy Mode - check before using as array
    if (allRepos.privacyMode || allRepos.privacyMode === true) {
      container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <i class="fas fa-lock" style="font-size: 3rem; margin-bottom: 1rem; display: block; opacity: 0.7;"></i>
                    <p>Privacy Mode Active</p>
                </div>
            `;
      return;
    }

    // Now safely check if it's an array with repos
    if (!Array.isArray(allRepos) || allRepos.length === 0) {
      container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <i class="fas fa-code" style="font-size: 3rem; margin-bottom: 1rem; display: block; opacity: 0.5;"></i>
                    <p>No projects to display</p>
                </div>
            `;
      return;
    }

    console.log(
      "Projects loaded:",
      allRepos.map((r) => r.name),
    );

    const fragment = document.createDocumentFragment();

    allRepos.forEach((repo, index) => {
      const card = document.createElement("div");
      card.className = "project-card animate-slide-up";
      card.style.animationDelay = `${index * 0.1}s`;

      const description = repo.description || "No description available";
      const language = repo.lang || repo.language || "Unknown";
      const author = repo.owner?.login || "Unknown";
      const nexVidDescription =
        "Stream movies and TV shows in a fast, modern hub with search, watchlists, and smooth playback.";

      // Determine badge based on repo name
      let badge = "";
      let badgeClass = "";
      let projectLink = repo.url;

      // Special handling for specific projects
      if (repo.name === "Biography") {
        badge = "current";
        badgeClass = "project-badge-current";
      } else if (repo.name === "Broadcast-generator") {
        badge = "collab";
        badgeClass = "project-badge-collab";
        projectLink = repo.url;
      } else if (repo.name === "NexVid") {
        badge = "archive";
        badgeClass = "project-badge-archive";
        projectLink = repo.url;
      } else if (repo.private) {
        badge = "private";
        badgeClass = "project-badge-private";
      } else {
        badge = "active";
        badgeClass = "project-badge-active";
      }

      card.innerHTML = `
                <div class="project-header">
                    <div class="project-title">${escapeHtml(repo.name)}</div>
                    ${badge ? `<span class="project-badge ${badgeClass}">${badge}</span>` : ""}
                </div>
                <div class="project-description">${escapeHtml(repo.name === "NexVid" ? nexVidDescription : description)}</div>
                <div class="project-footer">
                    <div class="project-stats">
                        <div class="project-stat" title="Language">
                            <i class="fas fa-code"></i>
                            <span>${escapeHtml(language)}</span>
                        </div>
                    </div>
                    <a href="${projectLink}" target="_blank" rel="noreferrer" class="project-link">
                        <span>View</span>
                        <i class="fas fa-external-link-alt"></i>
                    </a>
                </div>
            `;

      fragment.appendChild(card);
    });

    container.innerHTML = "";
    container.appendChild(fragment);

    // Add click tracking to project links
    document.querySelectorAll(".project-link").forEach((link) => {
      link.addEventListener("click", () => {
        const projectName =
          link.closest(".project-card")?.querySelector(".project-title")
            ?.textContent || "Unknown";
        if (window.umami) {
          window.umami.track("Project Viewed", { project: projectName });
        }
      });
    });

    // Observe project cards with IntersectionObserver (same logic as initScrollReveal)
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 },
    );

    document.querySelectorAll(".project-card").forEach((card) => {
      observer.observe(card);
    });
  } catch (error) {
    console.error("Error loading projects:", error);
    container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-secondary);">
                <i class="fas fa-exclamation-circle" style="font-size: 3rem; margin-bottom: 1rem; display: block; opacity: 0.5;"></i>
                <p>Failed to load projects</p>
                <small style="opacity: 0.6;">Check back later or visit <a href="https://github.com/${githubUsername}" target="_blank" rel="noreferrer" style="color: var(--primary); text-decoration: none;">GitHub</a></small>
            </div>
        `;
  }
}

// Helper function to escape HTML
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// --- WIP Notice Handler ---
// Initializes the Work-in-Progress notice banner
// Shows a dismissible notice to users that the site is under development
// Uses localStorage to remember if the user has dismissed the notice
function initWipNotice() {
  const notice = document.getElementById("wip-notice");
  const closeBtn = document.getElementById("wip-close");

  if (!notice || !closeBtn) return;

  // Check if user has dismissed the notice before
  const dismissed = localStorage.getItem("wip-notice-dismissed");
  if (dismissed === "true") {
    notice.style.display = "none";
    return;
  }

  // Handle close button
  closeBtn.addEventListener("click", () => {
    notice.classList.add("hidden");
    localStorage.setItem("wip-notice-dismissed", "true");
    setTimeout(() => {
      notice.style.display = "none";
    }, 300);
  });
}

function updateCopyrightYear() {
  const copyrightEl = document.getElementById("copyright-year");
  if (!copyrightEl) return;
  const currentYear = new Date().getFullYear();
  copyrightEl.textContent = `© ${currentYear} Piotrunius - All Rights Reserved`;
}

// --- GITHUB ACTIVITY TIMELINE ---
async function loadGitHubTimeline() {
  const timeline = document.getElementById("activity-timeline");
  if (!timeline) return;

  try {
    const stats = await getGitHubData();
    const activities = [];

    // Add commits
    if (stats.recentCommits) {
      stats.recentCommits
        .filter((c) => {
          const msg = (c.message || "").toLowerCase();
          const author = (c.author || "").toLowerCase();
          return !author.includes("bot") && !author.includes("action");
        })
        .slice(0, 10)
        .forEach((commit) => {
          activities.push({
            type: "commit",
            icon: "fa-code-commit",
            action: commit.message || "Commit",
            repo: commit.repo,
            time: commit.date,
            url: commit.url,
          });
        });
    }

    // Add starred repos
    if (stats.starred) {
      stats.starred.slice(0, 5).forEach((star) => {
        activities.push({
          type: "star",
          icon: "fa-star",
          action: `Starred ${star.name}`,
          details: star.description,
          repo: star.owner,
          time: star.starredAt,
          url: star.url,
        });
      });
    }

    // Sort by time
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));

    // Render timeline
    const fragment = document.createDocumentFragment();
    activities.slice(0, 15).forEach((activity, index) => {
      const item = document.createElement("div");
      item.className = "timeline-item";
      item.style.animationDelay = `${index * 0.05}s`;

      const timeAgo = getTimeAgo(activity.time);

      item.innerHTML = `
                <div class="timeline-icon">
                    <i class="fas ${activity.icon}"></i>
                </div>
                <div class="timeline-content">
                    <div class="timeline-header">
                        <div class="timeline-action">${escapeHtml(activity.action)}</div>
                        <div class="timeline-time">${timeAgo}</div>
                    </div>
                    ${activity.details ? `<div class="timeline-details">${escapeHtml(activity.details)}</div>` : ""}
                    ${activity.repo ? `<div class="timeline-repo"><i class="fas fa-code-branch"></i>${escapeHtml(activity.repo)}</div>` : ""}
                </div>
            `;

      if (activity.url) {
        item.style.cursor = "pointer";
        item.addEventListener("click", () => {
          window.open(activity.url, "_blank", "noreferrer");
        });
      }

      fragment.appendChild(item);
    });

    timeline.innerHTML = "";
    timeline.appendChild(fragment);
  } catch (error) {
    console.error("Error loading GitHub timeline:", error);
    timeline.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                <i class="fas fa-exclamation-circle" style="font-size: 2rem; opacity: 0.5;"></i>
                <p>Unable to load activity timeline</p>
            </div>
        `;
  }
}

function getTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
  return `${Math.floor(seconds / 2592000)}mo ago`;
}

// ===========================================
// ADVANCED TERMINAL SYSTEM
// ===========================================

const Terminal = {
  // State
  isOpen: false,
  isMinimized: false,
  isFullscreen: false,
  commandHistory: [],
  historyIndex: -1,
  currentPath: "~",
  commandCount: 0,
  todoList: [],
  aliases: {},
  env: {},
  matrixInterval: null,

  // Virtual File System
  fileSystem: {
    "~": {
      type: "dir",
      children: {
        "about.txt": {
          type: "file",
          content:
            "Hi! I'm Piotrunius - a developer and tech enthusiast from Poland.\nI love tinkering with Linux, writing scripts, and exploring new technologies.\nMy daily driver is Nobara (Fedora) with KDE Plasma.",
        },
        "contact.txt": {
          type: "file",
          content:
            "Email: piotrunius.v2@gmail.com\nDiscord: Piotrunius\nGitHub: github.com/Piotrunius",
        },
        "skills.txt": {
          type: "file",
          content:
            "Languages: Python, JavaScript, HTML/CSS, TypeScript\nFrameworks: React, Node.js\nTools: Docker, Git, Linux\nLearning: Always something new!",
        },
        projects: {
          type: "dir",
          children: {
            "portfolio.md": {
              type: "file",
              content:
                "# Portfolio Website\nThis very website you're viewing!\nBuilt with vanilla HTML, CSS, and JavaScript.\nFeatures: Glass morphism, particles, Spotify integration, and this terminal!",
            },
            "broadcast-generator.md": {
              type: "file",
              content:
                "# Broadcast Generator\nA tool for generating broadcast messages.\nStatus: Active Development",
            },
          },
        },
        secrets: {
          type: "dir",
          children: {
            ".hidden": {
              type: "file",
              content: 'You found the secret!\nType "konami" for a surprise!',
            },
            "easter_eggs.txt": {
              type: "file",
              content:
                "=== EASTER EGGS ===\n\nTry these hidden commands:\n\n[FUN]\n  - thanos      (snap half the page away)\n  - flip        (flip the entire page)\n  - party       (party mode!)\n  - nyan        (nyan cat)\n  - rickroll    (you know what this does)\n\n[DEV JOKES]\n  - emacs       (the other editor)\n  - bsod        (Windows experience)\n  - make me a sandwich\n\n[DANGEROUS]\n  - rm -rf *    (WARNING: destroys everything)\n\n[CLASSICS]\n  - matrix      (enter the matrix)\n  - starwars    (a long time ago...)\n  - cowsay      (moo!)\n\n[OTHER]\n  - coffee      (get some coffee)\n  - yes         (infinite yes)\n  - konami      (the code)",
            },
          },
        },
      },
    },
  },

  // Commands definition
  commands: {
    help: {
      description: "Show all available commands",
      usage: "help [command]",
      icon: "fa-question-circle",
      fn: function (args) {
        if (args[0]) {
          const cmd = Terminal.commands[args[0]];
          if (cmd) {
            return [
              { text: `Command: ${args[0]}`, class: "highlight" },
              { text: `Description: ${cmd.description}` },
              { text: `Usage: ${cmd.usage}` },
              cmd.examples ? { text: `Examples: ${cmd.examples}` } : null,
            ].filter(Boolean);
          }
          return [{ text: `Command not found: ${args[0]}`, class: "error" }];
        }

        const categories = {
          Navigation: [
            "help",
            "clear",
            "history",
            "pwd",
            "cd",
            "ls",
            "cat",
            "tree",
          ],
          Information: [
            "about",
            "skills",
            "projects",
            "contact",
            "social",
            "github",
            "spotify",
            "stats",
            "weather",
            "neofetch",
          ],
          "Fun & Games": [
            "matrix",
            "cowsay",
            "sl",
            "rps",
            "guess",
            "8ball",
            "dice",
            "tictactoe",
          ],
          Utilities: [
            "calc",
            "todo",
            "timer",
            "stopwatch",
            "color",
            "echo",
            "date",
            "whoami",
            "uname",
            "uptime",
            "uuid",
            "password",
            "hash",
            "base64",
            "shortcuts",
          ],
          "Text Tools": [
            "ascii",
            "figlet",
            "banner",
            "binary",
            "hex",
            "reverse",
          ],
          Network: ["ping", "curl", "qr"],
          Customization: ["theme", "alias", "export", "motd"],
          System: ["reboot", "exit", "sudo", "rm", "man", "hostname"],
        };

        const output = [
          {
            text: "+==============================================================+",
            class: "highlight",
          },
          {
            text: "|           PIOTRUNIUS TERMINAL v2.0 - HELP MENU              |",
            class: "highlight",
          },
          {
            text: "+==============================================================+",
            class: "highlight",
          },
          { text: "" },
        ];

        for (const [category, cmds] of Object.entries(categories)) {
          output.push({ text: `[${category}]`, class: "info" });
          const cmdLine = cmds.map((c) => {
            const cmd = Terminal.commands[c];
            return `  ${c.padEnd(12)} ${cmd ? cmd.description.substring(0, 35) : ""}`;
          });
          cmdLine.forEach((line) => output.push({ text: line }));
          output.push({ text: "" });
        }

        output.push({
          text: 'Type "help <command>" for detailed info on a specific command.',
          class: "system",
        });
        output.push({
          text: "Use Tab for auto-completion, UP/DOWN for history.",
          class: "system",
        });

        return output;
      },
    },

    clear: {
      description: "Clear the terminal screen",
      usage: "clear",
      icon: "fa-eraser",
      fn: function () {
        document.getElementById("terminal-output").innerHTML = "";
        return [];
      },
    },

    privacy: {
      description: "Manage global Privacy Mode",
      usage: "privacy [on|off] [password] (or type privacy to open GUI)",
      icon: "fa-lock",
      fn: async function (args) {
        if (!args[0]) {
          showPrivacyModal();
          return [
            { text: "Opening Privacy Mode control panel...", class: "info" },
          ];
        }

        const action = args[0].toLowerCase();
        if (action !== "on" && action !== "off" && action !== "toggle") {
          return [
            {
              text: "Invalid argument. Use 'on', 'off' or leave empty for GUI.",
              class: "error",
            },
          ];
        }

        if (action === "toggle") {
          showPrivacyModal();
          return [
            { text: "Opening Privacy Mode control panel...", class: "info" },
          ];
        }

        const enable = action === "on";
        const password = args[1];
        if (!password) {
          return [
            {
              text: "Password is required to change Privacy Mode from CLI. Usage: privacy [on|off] [password]",
              class: "error",
            },
          ];
        }

        try {
          const res = await fetch(
            "https://admin-control.piotrunius.workers.dev/",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                password,
                action: enable ? "enable" : "disable",
              }),
            },
          );
          const data = await res.json();
          if (data.success) {
            setTimeout(() => {
              window.location.reload();
            }, 1000);
            return [
              {
                text: `Privacy Mode successfully set to ${action.toUpperCase()}!`,
                class: "success",
              },
              {
                text: "Reloading page in 1 second to apply changes...",
                class: "info",
              },
            ];
          } else {
            return [
              {
                text: `Failed: ${data.error || "Unknown error"}`,
                class: "error",
              },
            ];
          }
        } catch (err) {
          return [{ text: `Error: ${err.message}`, class: "error" }];
        }
      },
    },

    history: {
      description: "Show command history",
      usage: "history [clear]",
      icon: "fa-history",
      fn: function (args) {
        if (args[0] === "clear") {
          Terminal.commandHistory = [];
          return [{ text: "History cleared.", class: "success" }];
        }
        if (Terminal.commandHistory.length === 0) {
          return [{ text: "No commands in history.", class: "warning" }];
        }
        return Terminal.commandHistory.map((cmd, i) => ({
          text: `  ${(i + 1).toString().padStart(3)}  ${cmd}`,
        }));
      },
    },

    pwd: {
      description: "Print working directory",
      usage: "pwd",
      icon: "fa-folder",
      fn: function () {
        return [{ text: Terminal.currentPath }];
      },
    },

    cd: {
      description: "Change directory",
      usage: "cd <directory>",
      icon: "fa-folder-open",
      fn: function (args) {
        const target = args[0] || "~";

        if (target === "~" || target === "/") {
          Terminal.currentPath = "~";
          Terminal.updatePromptPath();
          return [];
        }

        if (target === "..") {
          const parts = Terminal.currentPath.split("/");
          if (parts.length > 1) {
            parts.pop();
            Terminal.currentPath = parts.join("/") || "~";
          }
          Terminal.updatePromptPath();
          return [];
        }

        const newPath =
          Terminal.currentPath === "~"
            ? `~/${target}`
            : `${Terminal.currentPath}/${target}`;
        const node = Terminal.getNode(newPath);

        if (!node) {
          return [{ text: `cd: no such directory: ${target}`, class: "error" }];
        }
        if (node.type !== "dir") {
          return [{ text: `cd: not a directory: ${target}`, class: "error" }];
        }

        Terminal.currentPath = newPath;
        Terminal.updatePromptPath();
        return [];
      },
    },

    ls: {
      description: "List directory contents",
      usage: "ls [-la] [directory]",
      icon: "fa-list",
      fn: function (args) {
        let showAll = false;
        let showLong = false;
        let targetPath = Terminal.currentPath;

        args.forEach((arg) => {
          if (arg.startsWith("-")) {
            if (arg.includes("a")) showAll = true;
            if (arg.includes("l")) showLong = true;
          } else {
            targetPath = arg.startsWith("~")
              ? arg
              : Terminal.currentPath === "~"
                ? `~/${arg}`
                : `${Terminal.currentPath}/${arg}`;
          }
        });

        const node = Terminal.getNode(targetPath);
        if (!node) {
          return [
            {
              text: `ls: cannot access '${targetPath}': No such file or directory`,
              class: "error",
            },
          ];
        }

        if (node.type !== "dir") {
          return [{ text: targetPath.split("/").pop() }];
        }

        const entries = Object.entries(node.children || {});
        if (!showAll) {
          entries.filter(([name]) => !name.startsWith("."));
        }

        if (entries.length === 0) {
          return [{ text: "(empty directory)", class: "system" }];
        }

        if (showLong) {
          return entries.map(([name, item]) => {
            const isDir = item.type === "dir";
            const permissions = isDir ? "drwxr-xr-x" : "-rw-r--r--";
            const size = item.content ? item.content.length : 4096;
            const date = "Feb  2 12:00";
            const displayName = isDir
              ? `<span class="info">${name}/</span>`
              : name;
            return {
              text: `${permissions}  1 piotrunius  ${size.toString().padStart(5)}  ${date}  ${displayName}`,
              html: true,
            };
          });
        }

        const dirs = entries
          .filter(([, v]) => v.type === "dir")
          .map(([k]) => `<span class="info">${k}/</span>`);
        const files = entries
          .filter(([, v]) => v.type === "file")
          .map(([k]) => k);
        return [{ text: [...dirs, ...files].join("  "), html: true }];
      },
    },

    cat: {
      description: "Display file contents",
      usage: "cat <filename>",
      icon: "fa-file-alt",
      fn: function (args) {
        if (!args[0]) {
          return [{ text: "Usage: cat <filename>", class: "warning" }];
        }

        const path = args[0].startsWith("~")
          ? args[0]
          : Terminal.currentPath === "~"
            ? `~/${args[0]}`
            : `${Terminal.currentPath}/${args[0]}`;
        const node = Terminal.getNode(path);

        if (!node) {
          return [
            {
              text: `cat: ${args[0]}: No such file or directory`,
              class: "error",
            },
          ];
        }
        if (node.type === "dir") {
          return [{ text: `cat: ${args[0]}: Is a directory`, class: "error" }];
        }

        return node.content.split("\n").map((line) => ({ text: line }));
      },
    },

    tree: {
      description: "Display directory tree",
      usage: "tree [directory]",
      icon: "fa-sitemap",
      fn: function (args) {
        const targetPath = args[0] || Terminal.currentPath;
        const node = Terminal.getNode(targetPath);

        if (!node || node.type !== "dir") {
          return [
            { text: `tree: ${targetPath}: Not a directory`, class: "error" },
          ];
        }

        const output = [{ text: targetPath, class: "info" }];
        Terminal.buildTree(node, "", output);
        return output;
      },
    },

    about: {
      description: "Display information about me",
      usage: "about",
      icon: "fa-user",
      fn: function () {
        return [
          {
            text: "+-----------------------------------------+",
            class: "highlight",
          },
          {
            text: "|           ABOUT PIOTRUNIUS              |",
            class: "highlight",
          },
          {
            text: "+-----------------------------------------+",
            class: "highlight",
          },
          { text: "" },
          { text: "  [*] Name:      Piotrunius" },
          { text: "  [*] Location:  Poland" },
          { text: "  [*] Role:      Developer & Tech Enthusiast" },
          { text: "  [*] OS:        Nobara (Fedora)" },
          { text: "  [*] DE:        KDE Plasma" },
          { text: "" },
          {
            text: "  Curious tinkerer who loves to explore how things work.",
            class: "system",
          },
          {
            text: "  I write small scripts, keep a clean Linux workflow,",
            class: "system",
          },
          { text: "  and share tweaks with friends.", class: "system" },
          { text: "" },
          { text: '  Type "skills" to see my tech stack!', class: "info" },
        ];
      },
    },

    skills: {
      description: "Display my technical skills",
      usage: "skills",
      icon: "fa-code",
      fn: function () {
        const skills = [
          { name: "Python", level: 80 },
          { name: "JavaScript", level: 75 },
          { name: "HTML/CSS", level: 85 },
          { name: "React", level: 60 },
          { name: "TypeScript", level: 40 },
          { name: "Docker", level: 55 },
          { name: "Linux", level: 90 },
          { name: "Git", level: 70 },
        ];

        const output = [
          {
            text: "+---------------------------------------------------+",
            class: "highlight",
          },
          {
            text: "|               SKILLS & TECH STACK                 |",
            class: "highlight",
          },
          {
            text: "+---------------------------------------------------+",
            class: "highlight",
          },
          { text: "" },
        ];

        skills.forEach((skill) => {
          const filled = Math.floor(skill.level / 5);
          const empty = 20 - filled;
          const bar = "=".repeat(filled) + "-".repeat(empty);
          output.push({
            text: `  ${skill.name.padEnd(12)} [${bar}] ${skill.level}%`,
          });
        });

        return output;
      },
    },

    projects: {
      description: "List my projects",
      usage: "projects",
      icon: "fa-code-branch",
      fn: async function () {
        Terminal.print([
          { text: "Fetching projects from GitHub...", class: "info" },
        ]);

        const repos = await fetchGitHubRepos();

        if (!repos || repos.length === 0) {
          return [
            { text: "", class: "system" },
            { text: "Failed to fetch projects from GitHub.", class: "error" },
            { text: "Visit: https://github.com/Piotrunius", class: "system" },
          ];
        }

        const output = [
          {
            text: "+---------------------------------------------------+",
            class: "highlight",
          },
          {
            text: "|                   MY PROJECTS                     |",
            class: "highlight",
          },
          {
            text: "+---------------------------------------------------+",
            class: "highlight",
          },
          { text: "" },
        ];

        // Show top projects (max 5)
        const topProjects = repos.slice(0, 5);

        topProjects.forEach((repo, index) => {
          let badge = "[PROJECT]";
          let badgeClass = "system";

          if (repo.name === "Biography") {
            badge = "[THIS SITE]";
            badgeClass = "info";
          } else if (repo.name === "Broadcast-generator") {
            badge = "[COLLAB]";
            badgeClass = "highlight";
          } else if (repo.name === "NexVid") {
            badge = "[PRIVATE]";
            badgeClass = "warning";
          }

          output.push(
            { text: `  ${badge} ${repo.name}`, class: badgeClass },
            {
              text: `           ${repo.name === "NexVid" ? "Stream movies and TV shows in a fast, modern hub with search, watchlists, and smooth playback." : repo.description}`,
            },
          );

          if (index < topProjects.length - 1) {
            output.push({ text: "" });
          }
        });

        output.push(
          { text: "" },
          { text: `  Total public repos: ${repos.length}`, class: "info" },
          { text: "  Visit: https://github.com/Piotrunius", class: "system" },
        );

        return output;
      },
    },

    contact: {
      description: "Show contact information",
      usage: "contact",
      icon: "fa-envelope",
      fn: function () {
        return [
          {
            text: "+-----------------------------------------+",
            class: "highlight",
          },
          {
            text: "|            CONTACT INFO                 |",
            class: "highlight",
          },
          {
            text: "+-----------------------------------------+",
            class: "highlight",
          },
          { text: "" },
          { text: "  Email:    piotrunius.v2@gmail.com" },
          { text: "  Discord:  Piotrunius" },
          { text: "  GitHub:   github.com/Piotrunius" },
          { text: "  Insta:    @piotrunius" },
          { text: "" },
          { text: "  Feel free to reach out!", class: "success" },
        ];
      },
    },

    github: {
      description: "Open GitHub profile",
      usage: "github [repo]",
      icon: "fa-github",
      fn: function (args) {
        if (args[0]) {
          window.open(`https://github.com/Piotrunius/${args[0]}`, "_blank");
          return [{ text: `Opening repository: ${args[0]}`, class: "success" }];
        }
        window.open("https://github.com/Piotrunius", "_blank");
        return [{ text: "Opening GitHub profile...", class: "success" }];
      },
    },

    spotify: {
      description: "Open Spotify profile",
      usage: "spotify",
      icon: "fa-music",
      fn: function () {
        window.open("https://open.spotify.com/user/Piotrunius", "_blank");
        return [{ text: "Opening Spotify profile...", class: "success" }];
      },
    },

    shortcuts: {
      description: "Show keyboard shortcuts",
      usage: "shortcuts",
      icon: "fa-keyboard",
      fn: function () {
        return [
          { text: "Keyboard Shortcuts:", class: "highlight" },
          { text: "" },
          { text: "Terminal Control:", class: "info" },
          { text: "  Ctrl + `      Open/Close terminal" },
          { text: "  Escape        Close terminal (if open)" },
          { text: "  Enter         Execute command" },
          { text: "" },
          { text: "History Navigation:", class: "info" },
          { text: "  UP/DOWN       Navigate command history" },
          { text: "  Tab           Auto-complete command" },
          { text: "" },
          { text: "Easter Eggs:", class: "info" },
          { text: "  ↑ ↑ ↓ ↓ ← → ← → B A    Konami code!" },
          { text: "" },
          { text: "Tips:", class: "system" },
          { text: '  - Type "help" for all commands' },
          { text: '  - Type "help <command>" for command info' },
          { text: '  - Type "history" to see past commands' },
        ];
      },
    },

    social: {
      description: "Open social links",
      usage: "social [platform]",
      icon: "fa-share-alt",
      fn: function (args) {
        const links = {
          github: "https://github.com/Piotrunius",
          discord: "https://discord.com/users/1166309729371439104",
          spotify: "https://open.spotify.com/user/piotrunius",
          steam: "https://steamcommunity.com/id/piotrunius",
        };

        if (args[0]) {
          const platform = args[0].toLowerCase();
          if (links[platform]) {
            window.open(links[platform], "_blank");
            return [{ text: `Opening ${platform}...`, class: "success" }];
          }
          return [{ text: `Unknown platform: ${args[0]}`, class: "error" }];
        }

        return [
          { text: "Available platforms:", class: "info" },
          ...Object.keys(links).map((p) => ({ text: `  - ${p}` })),
          { text: "" },
          { text: "Usage: social <platform>", class: "system" },
        ];
      },
    },

    stats: {
      description: "Show GitHub statistics",
      usage: "stats",
      icon: "fa-chart-bar",
      fn: async function () {
        const projects =
          document.getElementById("stat-projects")?.textContent || "?";
        const commits =
          document.getElementById("stat-commits")?.textContent || "?";
        const gists = document.getElementById("stat-gists")?.textContent || "?";

        return [
          {
            text: "+-----------------------------------------+",
            class: "highlight",
          },
          {
            text: "|            GITHUB STATS                 |",
            class: "highlight",
          },
          {
            text: "+-----------------------------------------+",
            class: "highlight",
          },
          { text: "" },
          { text: `  Projects:  ${projects}` },
          { text: `  Commits:   ${commits}` },
          { text: `  Gists:     ${gists}` },
          { text: "" },
          { text: "  Data from GitHub Worker API", class: "system" },
        ];
      },
    },

    weather: {
      description: "Show weather for a city",
      usage: "weather <city>",
      icon: "fa-cloud-sun",
      fn: async function (args) {
        const city = args.join(" ");

        if (!city) {
          return [
            {
              text: "Please specify a city. Usage: weather <city>",
              class: "error",
            },
          ];
        }

        Terminal.print([
          { text: `Fetching weather for ${city}...`, class: "system" },
        ]);

        try {
          // Fetch weather from wttr.in
          const response = await fetch(
            `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
          );

          if (!response.ok) {
            throw new Error("Weather API error");
          }

          const data = await response.json();
          const current = data.current_condition[0];
          const area = data.nearest_area[0];

          const temp = current.temp_C;
          const feelsLike = current.FeelsLikeC;
          const humidity = current.humidity;
          const wind = current.windspeedKmph;
          const windDir = current.winddir16Point;
          const desc = current.weatherDesc[0].value;
          const visibility = current.visibility;
          const pressure = current.pressure;
          const uvIndex = current.uvIndex;
          const cloudCover = current.cloudcover;

          const cityName = area.areaName[0].value;
          const country = area.country[0].value;

          return [
            {
              text: "+---------------------------------------------------+",
              class: "highlight",
            },
            {
              text: `|  WEATHER: ${cityName}, ${country}`.padEnd(52) + "|",
              class: "highlight",
            },
            {
              text: "+---------------------------------------------------+",
              class: "highlight",
            },
            { text: "" },
            { text: `  Condition:    ${desc}` },
            { text: `  Temperature:  ${temp}C (feels like ${feelsLike}C)` },
            { text: `  Humidity:     ${humidity}%` },
            { text: `  Wind:         ${wind} km/h ${windDir}` },
            { text: `  Pressure:     ${pressure} hPa` },
            { text: `  Visibility:   ${visibility} km` },
            { text: `  UV Index:     ${uvIndex}` },
            { text: `  Cloud Cover:  ${cloudCover}%` },
            { text: "" },
            { text: "  Data from wttr.in", class: "system" },
          ];
        } catch (e) {
          // Fallback to simple format
          const city = args.join(" ") || "Warsaw";
          try {
            const response = await fetch(
              `https://wttr.in/${encodeURIComponent(city)}?format=%C+%t+%h+%w`,
            );
            const data = await response.text();
            return [
              { text: `Weather in ${city}:`, class: "info" },
              { text: `  ${data.trim()}` },
            ];
          } catch (e2) {
            return [{ text: "Unable to fetch weather data.", class: "error" }];
          }
        }
      },
    },

    neofetch: {
      description: "Display system information in style",
      usage: "neofetch",
      icon: "fa-desktop",
      fn: function () {
        const ascii = `
<span class="highlight"> ████████╗███████╗██████╗ ███╗   ███╗</span>
<span class="highlight"> ╚══██╔══╝██╔════╝██╔══██╗████╗ ████║</span>
<span class="highlight">    ██║   █████╗  ██████╔╝██╔████╔██║</span>
<span class="highlight">    ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║</span>
<span class="highlight">    ██║   ███████╗██║  ██║██║ ╚═╝ ██║</span>
<span class="highlight">    ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝</span>`;

        const info = [
          "",
          `<span class="info">guest</span>@<span class="highlight">piotrunius.dev</span>`,
          "-".repeat(25),
          `<span class="info">OS:</span> Web Browser`,
          `<span class="info">Host:</span> piotrunius.dev`,
          `<span class="info">Kernel:</span> JavaScript ES2024`,
          `<span class="info">Uptime:</span> ${Math.floor(performance.now() / 1000)}s`,
          `<span class="info">Shell:</span> Piotrunius Terminal v2.0`,
          `<span class="info">Resolution:</span> ${window.innerWidth}x${window.innerHeight}`,
          `<span class="info">Terminal:</span> Advanced Web Terminal`,
          `<span class="info">CPU:</span> ${navigator.hardwareConcurrency || "?"} cores`,
          `<span class="info">Memory:</span> ${navigator.deviceMemory || "?"}GB`,
          "",
          '<span style="background:#ff5f56;color:#ff5f56">###</span><span style="background:#ffbd2e;color:#ffbd2e">###</span><span style="background:#27c93f;color:#27c93f">###</span><span style="background:#00b8ff;color:#00b8ff">###</span><span style="background:#bd93f9;color:#bd93f9">###</span><span style="background:#ff79c6;color:#ff79c6">###</span>',
        ];

        const asciiLines = ascii.trim().split("\n");
        const output = [];

        for (let i = 0; i < Math.max(asciiLines.length, info.length); i++) {
          const left = asciiLines[i] || "".padEnd(40);
          const right = info[i] || "";
          output.push({ text: left + "  " + right, html: true });
        }

        return output;
      },
    },

    matrix: {
      description: "Enter the Matrix",
      usage: "matrix [stop]",
      icon: "fa-code",
      fn: function (args) {
        if (args[0] === "stop" && Terminal.matrixInterval) {
          clearInterval(Terminal.matrixInterval);
          Terminal.matrixInterval = null;
          const rain = document.querySelector(".matrix-rain");
          if (rain) rain.remove();
          return [{ text: "Matrix stopped.", class: "success" }];
        }

        if (Terminal.matrixInterval) {
          return [
            {
              text: 'Matrix is already running. Use "matrix stop" to stop.',
              class: "warning",
            },
          ];
        }

        const body = document.getElementById("terminal-body");
        let rain = document.querySelector(".matrix-rain");

        if (!rain) {
          rain = document.createElement("div");
          rain.className = "matrix-rain";
          body.insertBefore(rain, body.firstChild);
        }

        const chars =
          "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

        Terminal.matrixInterval = setInterval(() => {
          const column = document.createElement("div");
          column.className = "matrix-column";
          column.style.left = Math.random() * 100 + "%";
          column.style.animationDuration = 3 + Math.random() * 4 + "s";

          let text = "";
          for (let i = 0; i < 20; i++) {
            text += chars[Math.floor(Math.random() * chars.length)] + "\n";
          }
          column.textContent = text;
          rain.appendChild(column);

          setTimeout(() => column.remove(), 7000);
        }, 100);

        return [
          {
            text: 'Welcome to the Matrix... (use "matrix stop" to exit)',
            class: "success",
          },
        ];
      },
    },

    cowsay: {
      description: "Make a cow say something",
      usage: "cowsay <message>",
      icon: "fa-horse",
      fn: function (args) {
        const message = args.join(" ") || "Moo!";
        const border = "_".repeat(message.length + 2);

        return [
          { text: ` ${border}` },
          { text: `< ${message} >` },
          { text: ` ${"-".repeat(message.length + 2)}` },
          { text: "        \\   ^__^" },
          { text: "         \\  (oo)\\_______" },
          { text: "            (__)\\       )\\/\\" },
          { text: "                ||----w |" },
          { text: "                ||     ||" },
        ];
      },
    },

    sl: {
      description: "Steam Locomotive",
      usage: "sl",
      icon: "fa-train",
      fn: async function () {
        const frames = [
          "      ====        ________                ___________ ",
          "  _D _|  |_______/        \\__I_I_____===__|_________| ",
          "   |(_)---  |   H\\________/ |   |        =|___ ___|   ",
          "   /     |  |   H  |  |     |   |         ||_| |_||   ",
          "  |      |  |   H  |__--------------------| [___] |   ",
          "  | ________|___H__/__|_____/[][]~\\_______|       |   ",
          "  |/ |   |-----------I_____I [][] []  D   |=======|__ ",
          "__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ",
          " |/-=|___|=O=====O=====O=====O   |_____/~\\___/        ",
          "  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/            ",
        ];

        return frames.map((line) => ({ text: line, class: "highlight" }));
      },
    },

    rps: {
      description: "Play Rock Paper Scissors",
      usage: "rps <rock|paper|scissors>",
      icon: "fa-hand-rock",
      fn: function (args) {
        const choices = ["rock", "paper", "scissors"];
        const player = args[0]?.toLowerCase();

        if (!player || !choices.includes(player)) {
          return [
            { text: "Usage: rps <rock|paper|scissors>", class: "warning" },
          ];
        }

        const computer = choices[Math.floor(Math.random() * 3)];
        const icons = {
          rock: "[ROCK]",
          paper: "[PAPER]",
          scissors: "[SCISSORS]",
        };

        let result;
        if (player === computer) {
          result = { text: "It's a tie!", class: "warning" };
        } else if (
          (player === "rock" && computer === "scissors") ||
          (player === "paper" && computer === "rock") ||
          (player === "scissors" && computer === "paper")
        ) {
          result = { text: "You win!", class: "success" };
        } else {
          result = { text: "You lose!", class: "error" };
        }

        return [
          { text: `You: ${icons[player]} ${player}` },
          { text: `Computer: ${icons[computer]} ${computer}` },
          { text: "" },
          result,
        ];
      },
    },

    guess: {
      description: "Play number guessing game",
      usage: "guess [1-100]",
      icon: "fa-question",
      fn: function (args) {
        if (!Terminal.guessGame) {
          Terminal.guessGame = {
            number: Math.floor(Math.random() * 100) + 1,
            attempts: 0,
          };
          return [
            { text: "[GAME] Number Guessing Game Started!", class: "success" },
            { text: "I'm thinking of a number between 1 and 100." },
            { text: 'Use "guess <number>" to make a guess.' },
          ];
        }

        const guess = parseInt(args[0]);
        if (isNaN(guess) || guess < 1 || guess > 100) {
          return [
            {
              text: "Please guess a number between 1 and 100.",
              class: "warning",
            },
          ];
        }

        Terminal.guessGame.attempts++;

        if (guess === Terminal.guessGame.number) {
          const attempts = Terminal.guessGame.attempts;
          Terminal.guessGame = null;
          return [
            {
              text: `[WIN] Correct! The number was ${guess}!`,
              class: "success",
            },
            { text: `You got it in ${attempts} attempts!` },
          ];
        } else if (guess < Terminal.guessGame.number) {
          return [{ text: "[^] Higher!", class: "info" }];
        } else {
          return [{ text: "[v] Lower!", class: "info" }];
        }
      },
    },

    "8ball": {
      description: "Ask the magic 8-ball",
      usage: "8ball <question>",
      icon: "fa-circle",
      fn: function (args) {
        if (args.length === 0) {
          return [
            {
              text: "Ask a question! Usage: 8ball <question>",
              class: "warning",
            },
          ];
        }

        const responses = [
          "It is certain.",
          "It is decidedly so.",
          "Without a doubt.",
          "Yes - definitely.",
          "You may rely on it.",
          "As I see it, yes.",
          "Most likely.",
          "Outlook good.",
          "Yes.",
          "Signs point to yes.",
          "Reply hazy, try again.",
          "Ask again later.",
          "Better not tell you now.",
          "Cannot predict now.",
          "Concentrate and ask again.",
          "Don't count on it.",
          "My reply is no.",
          "My sources say no.",
          "Outlook not so good.",
          "Very doubtful.",
        ];

        return [
          {
            text:
              "[8] " + responses[Math.floor(Math.random() * responses.length)],
            class: "highlight",
          },
        ];
      },
    },

    dice: {
      description: "Roll dice",
      usage: "dice [sides] [count]",
      icon: "fa-dice",
      fn: function (args) {
        const sides = parseInt(args[0]) || 6;
        const count = parseInt(args[1]) || 1;

        if (count > 10) {
          return [{ text: "Maximum 10 dice allowed!", class: "warning" }];
        }

        const rolls = [];
        for (let i = 0; i < count; i++) {
          rolls.push(Math.floor(Math.random() * sides) + 1);
        }

        return [
          { text: `[DICE] Rolling ${count}d${sides}...`, class: "info" },
          { text: `Results: ${rolls.join(", ")}` },
          {
            text: `Total: ${rolls.reduce((a, b) => a + b, 0)}`,
            class: "success",
          },
        ];
      },
    },

    calc: {
      description: "Simple calculator",
      usage: "calc <expression>",
      icon: "fa-calculator",
      fn: function (args) {
        const expr = args.join(" ");
        if (!expr) {
          return [{ text: "Usage: calc <expression>", class: "warning" }];
        }

        try {
          // Safe evaluation (only math operations)
          const sanitized = expr.replace(/[^0-9+\-*/().%\s]/g, "");
          if (sanitized !== expr) {
            return [
              { text: "Invalid characters in expression!", class: "error" },
            ];
          }
          const result = Function('"use strict";return (' + sanitized + ")")();
          return [{ text: `${expr} = ${result}`, class: "success" }];
        } catch (e) {
          return [{ text: "Invalid expression!", class: "error" }];
        }
      },
    },

    todo: {
      description: "Manage todo list",
      usage: "todo [add|remove|list|clear] [task]",
      icon: "fa-list-check",
      fn: function (args) {
        const action = args[0]?.toLowerCase();
        const task = args.slice(1).join(" ");

        switch (action) {
          case "add":
            if (!task)
              return [{ text: "Usage: todo add <task>", class: "warning" }];
            Terminal.todoList.push({ text: task, done: false });
            return [{ text: `Added: ${task}`, class: "success" }];

          case "remove":
          case "rm":
            const idx = parseInt(task) - 1;
            if (isNaN(idx) || idx < 0 || idx >= Terminal.todoList.length) {
              return [{ text: "Invalid task number!", class: "error" }];
            }
            const removed = Terminal.todoList.splice(idx, 1)[0];
            return [{ text: `Removed: ${removed.text}`, class: "success" }];

          case "done":
            const doneIdx = parseInt(task) - 1;
            if (
              isNaN(doneIdx) ||
              doneIdx < 0 ||
              doneIdx >= Terminal.todoList.length
            ) {
              return [{ text: "Invalid task number!", class: "error" }];
            }
            Terminal.todoList[doneIdx].done = !Terminal.todoList[doneIdx].done;
            return [
              {
                text: `Toggled: ${Terminal.todoList[doneIdx].text}`,
                class: "success",
              },
            ];

          case "clear":
            Terminal.todoList = [];
            return [{ text: "Todo list cleared!", class: "success" }];

          case "list":
          default:
            if (Terminal.todoList.length === 0) {
              return [{ text: "Todo list is empty!", class: "system" }];
            }
            return [
              { text: "[TODO] Todo List:", class: "info" },
              ...Terminal.todoList.map((t, i) => ({
                text: `  ${i + 1}. ${t.done ? "[x]" : "[ ]"} ${t.text}`,
                class: t.done ? "success" : "",
              })),
            ];
        }
      },
    },

    timer: {
      description: "Set a timer",
      usage: "timer <seconds>",
      icon: "fa-hourglass",
      fn: function (args) {
        const seconds = parseInt(args[0]);
        if (isNaN(seconds) || seconds <= 0) {
          return [{ text: "Usage: timer <seconds>", class: "warning" }];
        }

        setTimeout(() => {
          Terminal.print([
            { text: `[TIMER] ${seconds}s elapsed!`, class: "success" },
          ]);
          // Play a sound or notification if possible
        }, seconds * 1000);

        return [{ text: `Timer set for ${seconds} seconds...`, class: "info" }];
      },
    },

    stopwatch: {
      description: "Stopwatch utility",
      usage: "stopwatch [start|stop|lap|reset]",
      icon: "fa-stopwatch",
      fn: function (args) {
        const action = args[0]?.toLowerCase() || "status";

        if (!Terminal.stopwatch) {
          Terminal.stopwatch = {
            running: false,
            start: 0,
            elapsed: 0,
            laps: [],
          };
        }

        switch (action) {
          case "start":
            if (Terminal.stopwatch.running) {
              return [{ text: "Stopwatch already running!", class: "warning" }];
            }
            Terminal.stopwatch.running = true;
            Terminal.stopwatch.start = Date.now() - Terminal.stopwatch.elapsed;
            return [{ text: "[SW] Stopwatch started!", class: "success" }];

          case "stop":
            if (!Terminal.stopwatch.running) {
              return [{ text: "Stopwatch not running!", class: "warning" }];
            }
            Terminal.stopwatch.running = false;
            Terminal.stopwatch.elapsed = Date.now() - Terminal.stopwatch.start;
            return [
              {
                text: `[SW] Stopped at: ${(Terminal.stopwatch.elapsed / 1000).toFixed(2)}s`,
                class: "success",
              },
            ];

          case "lap":
            if (!Terminal.stopwatch.running) {
              return [{ text: "Stopwatch not running!", class: "warning" }];
            }
            const lapTime = Date.now() - Terminal.stopwatch.start;
            Terminal.stopwatch.laps.push(lapTime);
            return [
              {
                text: `[LAP] Lap ${Terminal.stopwatch.laps.length}: ${(lapTime / 1000).toFixed(2)}s`,
                class: "info",
              },
            ];

          case "reset":
            Terminal.stopwatch = {
              running: false,
              start: 0,
              elapsed: 0,
              laps: [],
            };
            return [{ text: "[SW] Stopwatch reset!", class: "success" }];

          default:
            const current = Terminal.stopwatch.running
              ? Date.now() - Terminal.stopwatch.start
              : Terminal.stopwatch.elapsed;
            return [
              {
                text: `[SW] Time: ${(current / 1000).toFixed(2)}s`,
                class: "info",
              },
              {
                text: `Status: ${Terminal.stopwatch.running ? "Running" : "Stopped"}`,
              },
              { text: `Laps: ${Terminal.stopwatch.laps.length}` },
            ];
        }
      },
    },

    color: {
      description: "Show color palette or convert colors",
      usage: "color [hex]",
      icon: "fa-palette",
      fn: function (args) {
        if (args[0]) {
          const hex = args[0].replace("#", "");
          if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
            return [{ text: "Invalid hex color!", class: "error" }];
          }
          const r = parseInt(hex.substr(0, 2), 16);
          const g = parseInt(hex.substr(2, 2), 16);
          const b = parseInt(hex.substr(4, 2), 16);
          return [
            { text: `Color: #${hex}`, html: true },
            { text: `RGB: rgb(${r}, ${g}, ${b})` },
            {
              text: `<span style="background:#${hex};padding:2px 20px;border-radius:4px;">████████</span>`,
              html: true,
            },
          ];
        }

        return [
          { text: "Terminal Color Palette:", class: "info" },
          {
            text: '<span style="color:#ff5f56">██</span> Red (#ff5f56)',
            html: true,
          },
          {
            text: '<span style="color:#ffbd2e">██</span> Yellow (#ffbd2e)',
            html: true,
          },
          {
            text: '<span style="color:#27c93f">██</span> Green (#27c93f)',
            html: true,
          },
          {
            text: '<span style="color:#00b8ff">██</span> Blue (#00b8ff)',
            html: true,
          },
          {
            text: '<span style="color:#bd93f9">██</span> Purple (#bd93f9)',
            html: true,
          },
          {
            text: '<span style="color:#00ff88">██</span> Primary (#00ff88)',
            html: true,
          },
        ];
      },
    },

    echo: {
      description: "Echo text to terminal",
      usage: "echo <text>",
      icon: "fa-comment",
      fn: function (args) {
        return [{ text: args.join(" ") }];
      },
    },

    date: {
      description: "Show current date and time",
      usage: "date",
      icon: "fa-calendar",
      fn: function () {
        const now = new Date();
        return [{ text: now.toString() }];
      },
    },

    whoami: {
      description: "Display current user",
      usage: "whoami",
      icon: "fa-user",
      fn: function () {
        return [{ text: "guest" }];
      },
    },

    uname: {
      description: "Print system information",
      usage: "uname [-a]",
      icon: "fa-info-circle",
      fn: function (args) {
        if (args[0] === "-a") {
          return [
            { text: "WebOS 2.0.0 piotrunius.dev JavaScript ES2024 Browser" },
          ];
        }
        return [{ text: "WebOS" }];
      },
    },

    uptime: {
      description: "Show terminal uptime",
      usage: "uptime",
      icon: "fa-clock",
      fn: function () {
        const uptime = Math.floor(performance.now() / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        return [{ text: `up ${hours}h ${minutes}m ${seconds}s` }];
      },
    },

    theme: {
      description: "Toggle or set theme",
      usage: "theme [dark|light|toggle]",
      icon: "fa-moon",
      fn: function (args) {
        const action = args[0]?.toLowerCase() || "toggle";
        const body = document.body;

        switch (action) {
          case "dark":
            body.classList.remove("light-mode");
            localStorage.setItem("theme", "dark");
            return [{ text: "Theme set to dark mode.", class: "success" }];
          case "light":
            body.classList.add("light-mode");
            localStorage.setItem("theme", "light");
            return [{ text: "Theme set to light mode.", class: "success" }];
          default:
            body.classList.toggle("light-mode");
            const theme = body.classList.contains("light-mode")
              ? "light"
              : "dark";
            localStorage.setItem("theme", theme);
            return [
              { text: `Theme toggled to ${theme} mode.`, class: "success" },
            ];
        }
      },
    },

    alias: {
      description: "Create command aliases",
      usage: "alias [name=command]",
      icon: "fa-link",
      fn: function (args) {
        if (!args[0]) {
          if (Object.keys(Terminal.aliases).length === 0) {
            return [{ text: "No aliases defined.", class: "system" }];
          }
          return Object.entries(Terminal.aliases).map(([k, v]) => ({
            text: `${k}='${v}'`,
          }));
        }

        const match = args.join(" ").match(/^(\w+)=(.+)$/);
        if (!match) {
          return [{ text: "Usage: alias name=command", class: "warning" }];
        }

        Terminal.aliases[match[1]] = match[2];
        return [
          {
            text: `Alias created: ${match[1]}='${match[2]}'`,
            class: "success",
          },
        ];
      },
    },

    export: {
      description: "Set environment variables",
      usage: "export [NAME=value]",
      icon: "fa-cog",
      fn: function (args) {
        if (!args[0]) {
          return Object.entries(Terminal.env).map(([k, v]) => ({
            text: `${k}=${v}`,
          }));
        }

        const match = args.join(" ").match(/^(\w+)=(.*)$/);
        if (!match) {
          return [{ text: "Usage: export NAME=value", class: "warning" }];
        }

        Terminal.env[match[1]] = match[2];
        return [{ text: `${match[1]}=${match[2]}`, class: "success" }];
      },
    },

    motd: {
      description: "Show message of the day",
      usage: "motd",
      icon: "fa-newspaper",
      fn: function () {
        return Terminal.getWelcomeMessage();
      },
    },

    reboot: {
      description: "Reboot the terminal",
      usage: "reboot",
      icon: "fa-sync",
      fn: function () {
        Terminal.print([{ text: "Rebooting terminal...", class: "warning" }]);
        setTimeout(() => {
          document.getElementById("terminal-output").innerHTML = "";
          Terminal.commandHistory = [];
          Terminal.commandCount = 0;
          Terminal.currentPath = "~";
          Terminal.updatePromptPath();
          Terminal.print(Terminal.getWelcomeMessage());
        }, 1000);
        return [];
      },
    },

    exit: {
      description: "Close the terminal",
      usage: "exit",
      icon: "fa-sign-out-alt",
      fn: function () {
        Terminal.print([{ text: "Goodbye!", class: "success" }]);
        setTimeout(() => Terminal.close(), 500);
        return [];
      },
    },

    admin: {
      description: "Access admin mode with password verification",
      usage: "admin",
      icon: "fa-lock",
      fn: async function () {
        // Track admin command execution
        if (typeof umami !== "undefined") {
          umami.track("admin_command_executed");
        }

        // Prompt for password
        const password = window.prompt("Enter Admin Password:");

        // If user cancelled the prompt
        if (password === null) {
          if (typeof umami !== "undefined") {
            umami.track("admin_cancelled");
          }
          return [{ text: "Admin access cancelled.", class: "warning" }];
        }

        try {
          // Send POST request to Cloudflare Worker
          const response = await fetch(
            "https://admin-control.piotrunius.workers.dev",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                password: password,
                action: "toggle",
              }),
            },
          );

          // Parse JSON response
          const data = await response.json();

          // Handle response based on success flag
          if (data.success) {
            if (typeof umami !== "undefined") {
              umami.track("admin_password_success", {
                message: data.message,
                action: "toggle",
              });
            }
            Terminal.print([
              { text: data.message, class: "success" },
              { text: "Reloading page...", class: "info" },
            ]);
            setTimeout(() => window.location.reload(), 1000);
            return [];
          } else {
            if (typeof umami !== "undefined") {
              umami.track("admin_password_failed", {
                error: data.message || "Admin command failed",
              });
            }
            return [
              { text: data.message || "Admin command failed", class: "error" },
            ];
          }
        } catch (error) {
          if (typeof umami !== "undefined") {
            umami.track("admin_connection_error", {
              error: error.message,
            });
          }
          console.error("Admin command error:", error);
          return [{ text: "Connection Failed", class: "error" }];
        }
      },
    },

    sudo: {
      description: "Execute command as superuser",
      usage: "sudo <command>",
      icon: "fa-shield-alt",
      fn: function (args) {
        // Check if Konami mode is active
        if (
          typeof KonamiEasterEgg !== "undefined" &&
          KonamiEasterEgg.activated
        ) {
          if (args.length === 0) {
            return [
              { text: "[ROOT] Available root commands:", class: "success" },
              { text: "" },
              {
                text: "  sudo poweroff     - Initiate system shutdown",
                class: "info",
              },
              {
                text: "  sudo reboot       - Reboot the matrix",
                class: "info",
              },
              {
                text: "  sudo nuke         - Launch nuclear codes",
                class: "info",
              },
              {
                text: "  sudo selfdestruct - Initiate self-destruct",
                class: "info",
              },
              { text: "  sudo matrix       - Enter the Matrix", class: "info" },
              { text: "  sudo godmode      - Enable god mode", class: "info" },
              {
                text: "  sudo unlock       - Unlock all secrets",
                class: "info",
              },
              { text: "  sudo party        - Start a party", class: "info" },
              {
                text: "  sudo rainbow      - Taste the rainbow",
                class: "info",
              },
              { text: "  sudo glitch       - Maximum glitch", class: "info" },
              { text: "" },
              {
                text: "[!] You have ROOT ACCESS - Use wisely!",
                class: "warning",
              },
            ];
          }

          const cmd = args.join(" ").toLowerCase();

          if (cmd === "poweroff" || cmd === "shutdown") {
            setTimeout(() => {
              document.body.style.transition = "all 2s ease";
              document.body.style.filter = "brightness(0)";
              setTimeout(() => {
                document.body.style.filter = "";
                document.body.style.transition = "";
              }, 3000);
            }, 1000);
            return [
              {
                text: "[SYSTEM] Initiating shutdown sequence...",
                class: "warning",
              },
              { text: "[SYSTEM] Saving session data...", class: "system" },
              { text: "[SYSTEM] Terminating processes...", class: "system" },
              { text: "[SYSTEM] Goodbye, root.", class: "success" },
            ];
          }

          if (cmd === "reboot") {
            setTimeout(() => location.reload(), 2000);
            return [
              { text: "[SYSTEM] Rebooting matrix...", class: "warning" },
              {
                text: "[SYSTEM] Reconnecting in 3...2...1...",
                class: "system",
              },
            ];
          }

          if (cmd === "nuke") {
            Terminal.print([
              {
                text: "=======================================",
                class: "error",
              },
              {
                text: "   NUCLEAR LAUNCH SEQUENCE INITIATED   ",
                class: "error",
              },
              {
                text: "=======================================",
                class: "error",
              },
              { text: "", class: "" },
              { text: "  Enter launch codes: ********", class: "warning" },
              { text: "  Verifying authorization...", class: "system" },
              { text: "", class: "" },
            ]);
            setTimeout(() => {
              Terminal.print([
                { text: "  [!] LAUNCH ABORTED", class: "success" },
                {
                  text: "  Reason: This is just a simulation, you monster!",
                  class: "info",
                },
                {
                  text: "  No nukes were harmed in this process.",
                  class: "info",
                },
              ]);
            }, 2000);
            return [];
          }

          if (cmd === "selfdestruct") {
            let countdown = 10;
            const interval = setInterval(() => {
              if (countdown > 0) {
                Terminal.print([
                  {
                    text: `[!] SELF-DESTRUCT IN ${countdown}...`,
                    class: "error",
                  },
                ]);
                countdown--;
              } else {
                clearInterval(interval);
                Terminal.print([
                  { text: "[SYSTEM] Just kidding! :)", class: "success" },
                  {
                    text: "Did you really think I would do that?",
                    class: "info",
                  },
                ]);
              }
            }, 1000);
            return [
              {
                text: "[!] INITIATING SELF-DESTRUCT SEQUENCE!",
                class: "error",
              },
            ];
          }

          if (cmd === "matrix") {
            document.body.style.fontFamily = "Fira Code, monospace";
            document.body.style.color = "#00ff00";
            return [
              { text: "Wake up, Neo...", class: "success" },
              { text: "The Matrix has you...", class: "success" },
              { text: "Follow the white rabbit.", class: "success" },
              { text: "", class: "" },
              { text: "Knock, knock, Neo.", class: "info" },
            ];
          }

          if (cmd === "godmode") {
            document.body.classList.add("konami-godmode");
            return [
              { text: "================================", class: "success" },
              { text: "      GOD MODE ACTIVATED        ", class: "success" },
              { text: "================================", class: "success" },
              { text: "", class: "" },
              { text: "  Infinite power granted!", class: "info" },
              { text: "  You are now immortal.", class: "info" },
              { text: "  All achievements unlocked.", class: "info" },
            ];
          }

          if (cmd === "unlock") {
            return [
              { text: "[SYSTEM] Unlocking all secrets...", class: "warning" },
              { text: "", class: "" },
              { text: "SECRET #1: The cake is a lie", class: "success" },
              { text: "SECRET #2: There is no spoon", class: "success" },
              { text: "SECRET #3: 42 is the answer", class: "success" },
              { text: "SECRET #4: Piotrunius is awesome", class: "success" },
              {
                text: "SECRET #5: You found this easter egg!",
                class: "success",
              },
              { text: "", class: "" },
              { text: "[!] All secrets unlocked!", class: "info" },
            ];
          }

          if (cmd === "party") {
            // Create party effect
            const colors = [
              "#ff0000",
              "#00ff00",
              "#0000ff",
              "#ffff00",
              "#ff00ff",
              "#00ffff",
            ];
            let colorIndex = 0;
            const partyInterval = setInterval(() => {
              document.body.style.backgroundColor =
                colors[colorIndex % colors.length];
              colorIndex++;
            }, 200);
            setTimeout(() => {
              clearInterval(partyInterval);
              document.body.style.backgroundColor = "";
            }, 5000);
            return [
              { text: "  PARTY MODE ACTIVATED!  ", class: "success" },
              { text: "", class: "" },
              { text: "     (*^_^*)     ", class: "info" },
              { text: "    \\(^o^)/    ", class: "info" },
              { text: "   <(o_o<)    ", class: "info" },
            ];
          }

          if (cmd === "rainbow") {
            document.body.classList.add("konami-rainbow");
            setTimeout(
              () => document.body.classList.remove("konami-rainbow"),
              10000,
            );
            return [
              { text: "TASTE THE RAINBOW!", class: "success" },
              { text: "", class: "" },
              { text: "  R E D", style: "color: #ff0000" },
              { text: "  O R A N G E", style: "color: #ff8800" },
              { text: "  Y E L L O W", style: "color: #ffff00" },
              { text: "  G R E E N", style: "color: #00ff00" },
              { text: "  B L U E", style: "color: #0088ff" },
              { text: "  P U R P L E", style: "color: #8800ff" },
            ];
          }

          if (cmd === "glitch") {
            // Maximum glitch effect
            document.body.classList.add("konami-max-glitch");
            setTimeout(
              () => document.body.classList.remove("konami-max-glitch"),
              5000,
            );
            return [
              { text: "M̷̨̛̤̻̈́̏̕A̷͎̾X̵̱͒I̶̙͑M̷̰̄U̷̲͋M̴̨̛ ̵͔̈́G̶̣̈́L̶̤̎I̵̲͝T̴̰̾C̴̰̈́H̵̱̄", class: "error" },
              { text: "", class: "" },
              { text: "R̵͙̾E̵̬͑A̶̰̽L̵̝̈I̵̥͋T̴̰̾Y̶̰̽ ̵̱͊I̵̥̋S̵̰̈ ̵̱͑B̶̰̾R̵̙͋E̵̬̎A̶̰̽K̵̝̈I̵̥̋N̵̰͝G̶̰̈", class: "warning" },
              { text: "", class: "" },
              { text: "01001000 01000101 01001100 01010000", class: "system" },
            ];
          }

          return [
            { text: `[ROOT] Executing: ${cmd}`, class: "success" },
            { text: "[ROOT] Command completed successfully.", class: "info" },
          ];
        }

        // Normal mode - no root access
        if (args.length === 0) {
          return [{ text: "Usage: sudo <command>", class: "warning" }];
        }
        return [
          { text: "[sudo] password for guest: ********", class: "system" },
          {
            text: "Sorry, user guest is not in the sudoers file.",
            class: "error",
          },
          { text: "This incident will be reported.", class: "error" },
        ];
      },
    },

    rm: {
      description: "Remove files (simulated)",
      usage: "rm [-rf] <file>",
      icon: "fa-trash",
      fn: async function (args) {
        const hasRf = args.includes("-rf");
        const target = args.filter((a) => a !== "-rf").join(" ");

        // rm -rf * - nuclear option easter egg
        if (hasRf && (target === "*" || target === "/" || target === "/*")) {
          Terminal.print([
            {
              text: "rm: descending into root filesystem...",
              class: "warning",
            },
          ]);
          await new Promise((r) => setTimeout(r, 500));

          Terminal.print([
            { text: "rm: removing all files recursively...", class: "error" },
          ]);
          await new Promise((r) => setTimeout(r, 300));

          // Get all page elements to "delete"
          const sections = document.querySelectorAll(
            "section, .glass-card, .profile-section, .spotify-status-card, .music-player-card, .about-section, .steam-panel-section, .social-section, .stats-section, .skills-section, .activity-section, .projects-section, .gaming-section, .system-section",
          );
          const header = document.querySelector("header");
          const footer = document.querySelector(".copyright-bar");
          const buttons = document.querySelectorAll(".terminal-toggle");

          const allElements = [...sections, header, footer, ...buttons].filter(
            Boolean,
          );

          // Shuffle for random deletion order
          for (let i = allElements.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allElements[i], allElements[j]] = [allElements[j], allElements[i]];
          }

          // Delete elements one by one
          for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const name = el.className.split(" ")[0] || el.tagName.toLowerCase();

            Terminal.print([
              { text: `rm: removing '/${name}'...`, class: "system" },
            ]);

            // Glitch effect before removal
            el.style.transition = "all 0.3s ease";
            el.style.filter = "blur(2px) saturate(0)";
            el.style.transform = "scale(0.95) skewX(2deg)";
            el.style.opacity = "0.5";

            await new Promise((r) => setTimeout(r, 150));

            // Remove with animation
            el.style.transform = "scale(0) rotate(10deg)";
            el.style.opacity = "0";

            await new Promise((r) => setTimeout(r, 200));
            el.remove();
          }

          // Now delete the background
          Terminal.print([
            { text: "rm: removing /var/www/background...", class: "system" },
          ]);
          await new Promise((r) => setTimeout(r, 300));
          document.body.style.transition = "background 1s ease";
          document.body.style.background = "#000";

          // Remove particles
          const particles = document.getElementById("particles-js");
          if (particles) {
            particles.style.transition = "opacity 0.5s";
            particles.style.opacity = "0";
            await new Promise((r) => setTimeout(r, 500));
            particles.remove();
          }

          Terminal.print([{ text: "", class: "system" }]);
          Terminal.print([
            { text: "[!] CRITICAL: System files deleted", class: "error" },
          ]);
          await new Promise((r) => setTimeout(r, 500));

          Terminal.print([
            { text: "rm: removing /usr/bin/terminal...", class: "warning" },
          ]);
          await new Promise((r) => setTimeout(r, 800));

          Terminal.print([{ text: "", class: "system" }]);
          Terminal.print([
            { text: "[X] FATAL: No system remaining", class: "error" },
          ]);
          Terminal.print([{ text: "Goodbye...", class: "warning" }]);

          await new Promise((r) => setTimeout(r, 1500));

          // Terminal glitches out
          const terminalContainer = document.querySelector(
            ".terminal-container",
          );
          if (terminalContainer) {
            terminalContainer.style.transition = "all 0.5s ease";
            terminalContainer.style.filter = "blur(5px)";
            terminalContainer.style.transform = "scale(0.9) rotate(-2deg)";
            terminalContainer.style.opacity = "0.5";

            await new Promise((r) => setTimeout(r, 500));

            terminalContainer.style.transform = "scale(0) rotate(15deg)";
            terminalContainer.style.opacity = "0";

            await new Promise((r) => setTimeout(r, 600));
            terminalContainer.remove();
          }

          // Black screen with message
          await new Promise((r) => setTimeout(r, 1000));

          const deathScreen = document.createElement("div");
          deathScreen.style.cssText = `
                        position: fixed;
                        inset: 0;
                        background: #000;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        z-index: 99999999;
                        font-family: 'Fira Code', monospace;
                        color: #ff3333;
                        text-align: center;
                        animation: fadeIn 1s ease;
                    `;
          deathScreen.innerHTML = `
                        <div style="font-size: 3rem; margin-bottom: 1rem;">[X]</div>
                        <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">SYSTEM DESTROYED</div>
                        <div style="font-size: 0.9rem; color: #666; margin-bottom: 2rem;">All files have been permanently deleted.</div>
                        <div style="font-size: 0.8rem; color: #444;">(Refresh to restore)</div>
                        <button onclick="location.reload()" style="
                            margin-top: 2rem;
                            padding: 0.75rem 2rem;
                            background: transparent;
                            border: 1px solid #ff3333;
                            color: #ff3333;
                            font-family: 'Fira Code', monospace;
                            cursor: pointer;
                            transition: all 0.3s ease;
                        " onmouseover="this.style.background='#ff3333';this.style.color='#000'" onmouseout="this.style.background='transparent';this.style.color='#ff3333'">
                            Reboot System
                        </button>
                    `;
          document.body.appendChild(deathScreen);

          return [];
        }

        // rm -rf <path>
        if (hasRf && target) {
          return [{ text: `Removed: ${target}`, class: "success" }];
        }

        // Regular rm without -rf
        if (!hasRf && target) {
          return [
            {
              text: `rm: cannot remove '${target}': Permission denied`,
              class: "error",
            },
          ];
        }

        return [{ text: "Usage: rm [-rf] <file/path>", class: "warning" }];
      },
    },

    konami: {
      description: "Secret command",
      usage: "konami",
      icon: "fa-gamepad",
      hidden: true,
      fn: function () {
        return [
          {
            text: "Try: up up down down left right left right b a",
            class: "highlight",
          },
        ];
      },
    },

    // Easter egg: sudo make me a sandwich
    sandwich: {
      description: "Make a sandwich",
      usage: "sandwich",
      icon: "fa-bread-slice",
      hidden: true,
      fn: function () {
        return [{ text: "What? Make it yourself.", class: "error" }];
      },
    },

    // Easter egg: make command
    make: {
      description: "Make something",
      usage: "make <target>",
      icon: "fa-hammer",
      hidden: true,
      fn: function (args) {
        const target = args.join(" ").toLowerCase();
        if (target === "me a sandwich") {
          return [{ text: "What? Make it yourself.", class: "error" }];
        }
        if (target === "love") {
          return [
            {
              text: "make: *** No rule to make target 'love'. Stop.",
              class: "error",
            },
          ];
        }
        if (target === "money") {
          return [
            {
              text: "make: *** Insufficient funds to make 'money'. Stop.",
              class: "error",
            },
          ];
        }
        return [
          { text: `make: *** No targets specified. Stop.`, class: "warning" },
        ];
      },
    },

    // Easter egg: Thanos snap
    thanos: {
      description: "Perfectly balanced",
      usage: "thanos",
      icon: "fa-hand-sparkles",
      hidden: true,
      fn: async function () {
        Terminal.print([{ text: "*snap*", class: "warning" }]);
        await new Promise((r) => setTimeout(r, 500));

        Terminal.print([
          {
            text: "Perfectly balanced, as all things should be...",
            class: "highlight",
          },
        ]);
        await new Promise((r) => setTimeout(r, 1000));

        const allElements = document.querySelectorAll("section, .glass-card");
        const elementsArray = Array.from(allElements);

        // Randomly select half
        for (let i = elementsArray.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [elementsArray[i], elementsArray[j]] = [
            elementsArray[j],
            elementsArray[i],
          ];
        }

        const halfLength = Math.floor(elementsArray.length / 2);
        const toRemove = elementsArray.slice(0, halfLength);

        for (const el of toRemove) {
          el.style.transition = "all 1s ease";
          el.style.filter = "blur(3px)";
          el.style.opacity = "0";
          el.style.transform = "scale(0.8) translateY(-20px)";
        }

        await new Promise((r) => setTimeout(r, 1500));
        toRemove.forEach((el) => el.remove());

        return [
          { text: "", class: "system" },
          {
            text: `${halfLength} elements have been dusted.`,
            class: "warning",
          },
          { text: "Refresh to restore the universe.", class: "info" },
        ];
      },
    },

    // Easter egg: Nyan cat
    nyan: {
      description: "Nyan cat",
      usage: "nyan",
      icon: "fa-cat",
      hidden: true,
      fn: async function () {
        const nyanFrames = [
          "≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋╭━━━━━━━━╮",
          "≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋┃ ▀ ω ▀  ┃☆",
          "≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋╰━━━━━━━━╯",
          "≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋  ╱│ │ │╲",
        ];
        const colors = [
          "#ff0000",
          "#ff9900",
          "#ffff00",
          "#33ff00",
          "#0099ff",
          "#6633ff",
        ];

        Terminal.print([
          { text: ">>> NYAN CAT MODE ACTIVATED <<<", class: "highlight" },
        ]);

        // Add rainbow trail effect to page
        document.body.style.transition = "all 0.3s ease";

        for (let i = 0; i < 10; i++) {
          const color = colors[i % colors.length];
          document.body.style.boxShadow = `inset 0 0 100px ${color}40`;

          for (const frame of nyanFrames) {
            Terminal.print([{ text: frame, class: "highlight" }]);
          }
          Terminal.print([
            { text: `${"≋".repeat(i + 5)} NYAN! ~~~`, class: "success" },
          ]);
          await new Promise((r) => setTimeout(r, 200));
        }

        document.body.style.boxShadow = "";

        return [
          { text: "", class: "system" },
          { text: "Nyan cat has left the building!", class: "info" },
        ];
      },
    },

    // Easter egg: Rickroll
    rickroll: {
      description: "Never gonna give you up",
      usage: "rickroll",
      icon: "fa-music",
      hidden: true,
      fn: function () {
        window.open("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "_blank");
        return [
          { text: "[~] Never gonna give you up [~]", class: "highlight" },
          { text: "[~] Never gonna let you down [~]", class: "highlight" },
          {
            text: "[~] Never gonna run around and desert you [~]",
            class: "highlight",
          },
          { text: "", class: "system" },
          { text: "You just got Rick Rolled!", class: "success" },
        ];
      },
    },

    // Easter egg: emacs
    emacs: {
      description: "Open emacs",
      usage: "emacs",
      icon: "fa-code",
      hidden: true,
      fn: function () {
        return [
          { text: "EMACS: Escape Meta Alt Control Shift", class: "highlight" },
          { text: "", class: "system" },
          { text: "Eight Megs And Constantly Swapping", class: "warning" },
          { text: "Eventually Mangles All Computer Storage", class: "warning" },
          { text: "", class: "system" },
          { text: "Just use VSCode.", class: "info" },
        ];
      },
    },

    // Easter egg: Windows BSOD
    bsod: {
      description: "Blue screen of death",
      usage: "bsod",
      icon: "fa-skull",
      hidden: true,
      fn: async function () {
        Terminal.print([
          { text: "Initiating Windows experience...", class: "warning" },
        ]);
        await new Promise((r) => setTimeout(r, 1000));

        const bsod = document.createElement("div");
        bsod.id = "bsod-screen";
        bsod.style.cssText = `
                    position: fixed;
                    inset: 0;
                    background: #0078d7;
                    z-index: 99999999;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    font-family: 'Segoe UI', sans-serif;
                    color: white;
                    text-align: center;
                    padding: 2rem;
                    animation: fadeIn 0.5s ease;
                `;
        bsod.innerHTML = `
                    <div style="font-size: 8rem; margin-bottom: 1rem;">:(</div>
                    <div style="font-size: 1.5rem; margin-bottom: 1rem;">Your PC ran into a problem and needs to restart.</div>
                    <div style="font-size: 1rem; margin-bottom: 2rem;">We're just collecting some error info, and then we'll restart for you.</div>
                    <div style="font-size: 1.2rem; margin-bottom: 0.5rem;"><span id="bsod-percent">0</span>% complete</div>
                    <div style="font-size: 0.8rem; color: rgba(255,255,255,0.7); margin-top: 2rem;">Stop code: PIOTRUNIUS_EASTER_EGG</div>
                    <div style="margin-top: 3rem; font-size: 0.9rem;">
                        <div>If you call a support person, give them this info:</div>
                        <div style="font-family: monospace; margin-top: 0.5rem;">Error: USER_CURIOSITY_OVERFLOW</div>
                    </div>
                `;
        document.body.appendChild(bsod);

        // Fake loading
        const percentEl = bsod.querySelector("#bsod-percent");
        for (let i = 0; i <= 100; i += Math.random() * 15) {
          percentEl.textContent = Math.min(100, Math.floor(i));
          await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
        }
        percentEl.textContent = "100";

        await new Promise((r) => setTimeout(r, 1500));

        // Remove BSOD
        bsod.style.transition = "opacity 0.5s ease";
        bsod.style.opacity = "0";
        await new Promise((r) => setTimeout(r, 500));
        bsod.remove();

        return [
          {
            text: "Windows has recovered from an unexpected error.",
            class: "success",
          },
          { text: "(Just kidding, this is Linux territory!)", class: "info" },
        ];
      },
    },

    // Easter egg: Yes infinite
    yes: {
      description: "Print y forever",
      usage: "yes [text]",
      icon: "fa-repeat",
      hidden: true,
      fn: async function (args) {
        const text = args.join(" ") || "y";
        Terminal.print([
          {
            text: `Printing "${text}" forever... (not really)`,
            class: "warning",
          },
        ]);

        for (let i = 0; i < 50; i++) {
          Terminal.print([{ text: text, class: "system" }]);
          await new Promise((r) => setTimeout(r, 30));
        }

        return [
          { text: "", class: "system" },
          { text: "^C", class: "error" },
          { text: "Interrupted. (You're welcome)", class: "info" },
        ];
      },
    },

    // Easter egg: Party mode
    party: {
      description: "Party time!",
      usage: "party",
      icon: "fa-music",
      hidden: true,
      fn: async function () {
        document.body.style.transition = "all 0.2s ease";

        Terminal.print([
          { text: "*** PARTY MODE ACTIVATED! ***", class: "highlight" },
        ]);

        const colors = [
          "#ff0066",
          "#00ff66",
          "#0066ff",
          "#ff6600",
          "#6600ff",
          "#00ffff",
          "#ffff00",
        ];

        for (let i = 0; i < 30; i++) {
          const color = colors[i % colors.length];
          document.body.style.filter = `hue-rotate(${i * 36}deg)`;
          document.body.style.transform = `scale(${1 + Math.sin(i * 0.3) * 0.02}) rotate(${Math.sin(i * 0.5) * 2}deg)`;

          if (i % 5 === 0) {
            Terminal.print([
              {
                text: ["~", "*", "+", "#", "=", "-"][i % 6].repeat(20),
                class: "success",
              },
            ]);
          }

          await new Promise((r) => setTimeout(r, 100));
        }

        document.body.style.filter = "";
        document.body.style.transform = "";

        return [
          { text: "", class: "system" },
          { text: "Party's over! Back to work...", class: "info" },
        ];
      },
    },

    // Easter egg: Flip the page
    flip: {
      description: "Flip the page",
      usage: "flip",
      icon: "fa-sync",
      hidden: true,
      fn: async function () {
        Terminal.print([{ text: "(╯°□°)╯︵ ┻━┻", class: "warning" }]);

        document.body.style.transition = "transform 1s ease";
        document.body.style.transform = "rotate(180deg)";

        await new Promise((r) => setTimeout(r, 3000));

        Terminal.print([{ text: "┬─┬ノ( º _ ºノ)", class: "info" }]);
        document.body.style.transform = "rotate(0deg)";

        await new Promise((r) => setTimeout(r, 1000));
        document.body.style.transition = "";

        return [{ text: "Okay, I put it back.", class: "success" }];
      },
    },

    // Easter egg: Coffee
    coffee: {
      description: "Get some coffee",
      usage: "coffee",
      icon: "fa-mug-hot",
      hidden: true,
      fn: function () {
        return [
          { text: "        ))))", class: "warning" },
          { text: "       ((((", class: "warning" },
          { text: "     +-----+", class: "highlight" },
          { text: "     |     |]", class: "highlight" },
          { text: "     `-----'", class: "highlight" },
          { text: "_____|_____|_____", class: "system" },
          { text: "", class: "system" },
          { text: "Here's your coffee!", class: "success" },
          { text: "Now get back to coding...", class: "info" },
        ];
      },
    },

    // Easter egg: Starwars intro
    starwars: {
      description: "A long time ago in a galaxy far far away",
      usage: "starwars",
      icon: "fa-jedi",
      hidden: true,
      fn: async function () {
        const intro = [
          "",
          "          A long time ago in a galaxy far,",
          "                     far away....",
          "",
          "",
          "███████╗████████╗ █████╗ ██████╗",
          "██╔════╝╚══██╔══╝██╔══██╗██╔══██╗",
          "███████╗   ██║   ███████║██████╔╝",
          "╚════██║   ██║   ██╔══██║██╔══██╗",
          "███████║   ██║   ██║  ██║██║  ██║",
          "╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝",
          "",
          "██╗    ██╗ █████╗ ██████╗ ███████╗",
          "██║    ██║██╔══██╗██╔══██╗██╔════╝",
          "██║ █╗ ██║███████║██████╔╝███████╗",
          "██║███╗██║██╔══██║██╔══██╗╚════██║",
          "╚███╔███╔╝██║  ██║██║  ██║███████║",
          " ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝",
          "",
          "       EPISODE IV: A NEW HOPE",
          "",
        ];

        for (const line of intro) {
          Terminal.print([{ text: line, class: "highlight" }]);
          await new Promise((r) => setTimeout(r, 150));
        }

        return [
          { text: "", class: "system" },
          { text: "May the Force be with you.", class: "success" },
        ];
      },
    },

    ping: {
      description: "Simulate ping to host",
      usage: "ping <host>",
      icon: "fa-satellite-dish",
      fn: async function (args) {
        const host = args[0] || "piotrunius.dev";
        const results = [];
        results.push({ text: `PING ${host}`, class: "info" });

        for (let i = 0; i < 4; i++) {
          const time = (Math.random() * 50 + 10).toFixed(2);
          Terminal.print([
            {
              text: `64 bytes from ${host}: icmp_seq=${i + 1} time=${time} ms`,
            },
          ]);
          await new Promise((r) => setTimeout(r, 500));
        }

        return [
          { text: "" },
          { text: `--- ${host} ping statistics ---`, class: "system" },
          { text: "4 packets transmitted, 4 received, 0% packet loss" },
        ];
      },
    },

    base64: {
      description: "Encode/decode base64",
      usage: "base64 [encode|decode] <text>",
      icon: "fa-key",
      fn: function (args) {
        const action = args[0]?.toLowerCase();
        const text = args.slice(1).join(" ");

        if (!action || !text) {
          return [
            { text: "Usage: base64 [encode|decode] <text>", class: "warning" },
          ];
        }

        try {
          if (action === "encode") {
            return [{ text: btoa(text), class: "success" }];
          } else if (action === "decode") {
            return [{ text: atob(text), class: "success" }];
          }
          return [
            {
              text: "Use: base64 encode <text> OR base64 decode <text>",
              class: "warning",
            },
          ];
        } catch (e) {
          return [
            { text: "Invalid input for base64 operation.", class: "error" },
          ];
        }
      },
    },

    hash: {
      description: "Generate hash of text",
      usage: "hash <text>",
      icon: "fa-fingerprint",
      fn: async function (args) {
        const text = args.join(" ");
        if (!text) {
          return [{ text: "Usage: hash <text>", class: "warning" }];
        }

        // Simple hash function
        const simpleHash = (str) => {
          let hash = 0;
          for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
          }
          return Math.abs(hash).toString(16).padStart(8, "0");
        };

        // Try to use SubtleCrypto for SHA-256
        try {
          const encoder = new TextEncoder();
          const data = encoder.encode(text);
          const hashBuffer = await crypto.subtle.digest("SHA-256", data);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const sha256 = hashArray
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

          return [
            { text: "Hash results:", class: "info" },
            { text: `  SHA-256: ${sha256}` },
            { text: `  Simple:  ${simpleHash(text)}` },
          ];
        } catch (e) {
          return [
            { text: "Hash result:", class: "info" },
            { text: `  Simple: ${simpleHash(text)}` },
          ];
        }
      },
    },

    uuid: {
      description: "Generate a UUID",
      usage: "uuid",
      icon: "fa-barcode",
      fn: function () {
        const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
          /[xy]/g,
          function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          },
        );
        return [
          { text: "Generated UUID:", class: "info" },
          { text: `  ${uuid}`, class: "success" },
        ];
      },
    },

    password: {
      description: "Generate a secure password",
      usage: "password [length]",
      icon: "fa-lock",
      fn: function (args) {
        const length = parseInt(args[0]) || 16;
        if (length < 8 || length > 64) {
          return [
            {
              text: "Password length must be between 8 and 64.",
              class: "warning",
            },
          ];
        }

        const chars =
          "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
        let password = "";
        for (let i = 0; i < length; i++) {
          password += chars[Math.floor(Math.random() * chars.length)];
        }

        return [
          { text: "Generated Password:", class: "info" },
          { text: `  ${password}`, class: "success" },
          { text: "" },
          { text: `  Length: ${length} characters`, class: "system" },
        ];
      },
    },

    qr: {
      description: "Generate QR code (text output)",
      usage: "qr <text>",
      icon: "fa-qrcode",
      fn: function (args) {
        const text = args.join(" ");
        if (!text) {
          return [{ text: "Usage: qr <text>", class: "warning" }];
        }

        // Simple ASCII art placeholder (actual QR would need a library)
        return [
          { text: "QR Code for: " + text, class: "info" },
          { text: "" },
          { text: "  +-----------------------------------------------+" },
          { text: "  |  [QR]  Scan with your phone camera            |" },
          { text: "  |                                               |" },
          { text: "  |  URL: https://api.qrserver.com/v1/           |" },
          { text: "  |       create-qr-code/?size=200x200&          |" },
          {
            text:
              "  |       data=" +
              encodeURIComponent(text).substring(0, 20) +
              "...    |",
          },
          { text: "  +-----------------------------------------------+" },
          { text: "" },
          {
            text: "  Visit the URL above to get your QR code image.",
            class: "system",
          },
        ];
      },
    },

    ascii: {
      description: "Convert text to ASCII art",
      usage: "ascii <text>",
      icon: "fa-font",
      fn: function (args) {
        const text = args.join(" ").toUpperCase();
        if (!text) {
          return [{ text: "Usage: ascii <text>", class: "warning" }];
        }

        // Simple block letters for A-Z and 0-9
        const letters = {
          A: ["  A  ", " A A ", "AAAAA", "A   A", "A   A"],
          B: ["BBBB ", "B   B", "BBBB ", "B   B", "BBBB "],
          C: [" CCC ", "C    ", "C    ", "C    ", " CCC "],
          D: ["DDD  ", "D  D ", "D   D", "D  D ", "DDD  "],
          E: ["EEEEE", "E    ", "EEE  ", "E    ", "EEEEE"],
          F: ["FFFFF", "F    ", "FFF  ", "F    ", "F    "],
          G: [" GGG ", "G    ", "G GGG", "G   G", " GGG "],
          H: ["H   H", "H   H", "HHHHH", "H   H", "H   H"],
          I: ["IIIII", "  I  ", "  I  ", "  I  ", "IIIII"],
          J: ["JJJJJ", "   J ", "   J ", "J  J ", " JJ  "],
          K: ["K   K", "K  K ", "KK   ", "K  K ", "K   K"],
          L: ["L    ", "L    ", "L    ", "L    ", "LLLLL"],
          M: ["M   M", "MM MM", "M M M", "M   M", "M   M"],
          N: ["N   N", "NN  N", "N N N", "N  NN", "N   N"],
          O: [" OOO ", "O   O", "O   O", "O   O", " OOO "],
          P: ["PPPP ", "P   P", "PPPP ", "P    ", "P    "],
          Q: [" QQQ ", "Q   Q", "Q Q Q", "Q  QQ", " QQQQ"],
          R: ["RRRR ", "R   R", "RRRR ", "R  R ", "R   R"],
          S: [" SSS ", "S    ", " SSS ", "    S", "SSSS "],
          T: ["TTTTT", "  T  ", "  T  ", "  T  ", "  T  "],
          U: ["U   U", "U   U", "U   U", "U   U", " UUU "],
          V: ["V   V", "V   V", "V   V", " V V ", "  V  "],
          W: ["W   W", "W   W", "W W W", "WW WW", "W   W"],
          X: ["X   X", " X X ", "  X  ", " X X ", "X   X"],
          Y: ["Y   Y", " Y Y ", "  Y  ", "  Y  ", "  Y  "],
          Z: ["ZZZZZ", "   Z ", "  Z  ", " Z   ", "ZZZZZ"],
          " ": ["     ", "     ", "     ", "     ", "     "],
          "!": ["  !  ", "  !  ", "  !  ", "     ", "  !  "],
        };

        const lines = ["", "", "", "", ""];
        for (const char of text.substring(0, 10)) {
          const letter = letters[char] || letters[" "];
          for (let i = 0; i < 5; i++) {
            lines[i] += letter[i] + " ";
          }
        }

        return lines.map((line) => ({ text: "  " + line, class: "highlight" }));
      },
    },

    binary: {
      description: "Convert text to binary",
      usage: "binary <text>",
      icon: "fa-microchip",
      fn: function (args) {
        const text = args.join(" ");
        if (!text) {
          return [{ text: "Usage: binary <text>", class: "warning" }];
        }

        const binary = text
          .split("")
          .map((char) => {
            return char.charCodeAt(0).toString(2).padStart(8, "0");
          })
          .join(" ");

        return [{ text: "Binary:", class: "info" }, { text: `  ${binary}` }];
      },
    },

    hex: {
      description: "Convert text to hexadecimal",
      usage: "hex <text>",
      icon: "fa-hashtag",
      fn: function (args) {
        const text = args.join(" ");
        if (!text) {
          return [{ text: "Usage: hex <text>", class: "warning" }];
        }

        const hexStr = text
          .split("")
          .map((char) => {
            return char.charCodeAt(0).toString(16).padStart(2, "0");
          })
          .join(" ");

        return [
          { text: "Hexadecimal:", class: "info" },
          { text: `  ${hexStr}` },
        ];
      },
    },

    reverse: {
      description: "Reverse text",
      usage: "reverse <text>",
      icon: "fa-exchange-alt",
      fn: function (args) {
        const text = args.join(" ");
        if (!text) {
          return [{ text: "Usage: reverse <text>", class: "warning" }];
        }
        return [{ text: text.split("").reverse().join(""), class: "success" }];
      },
    },

    figlet: {
      description: "Display text in large ASCII letters",
      usage: "figlet <text>",
      icon: "fa-heading",
      fn: function (args) {
        return Terminal.commands.ascii.fn(args);
      },
    },

    banner: {
      description: "Display a text banner",
      usage: "banner <text>",
      icon: "fa-flag",
      fn: function (args) {
        const text = args.join(" ") || "HELLO";
        const width = Math.max(text.length + 10, 30);
        const border = "+" + "-".repeat(width - 2) + "+";
        const padding = "|" + " ".repeat(width - 2) + "|";
        const textLine =
          "|" +
          text
            .toUpperCase()
            .padStart((width + text.length - 2) / 2)
            .padEnd(width - 2) +
          "|";

        return [
          { text: border, class: "highlight" },
          { text: padding, class: "highlight" },
          { text: textLine, class: "highlight" },
          { text: padding, class: "highlight" },
          { text: border, class: "highlight" },
        ];
      },
    },

    hostname: {
      description: "Display system hostname",
      usage: "hostname",
      icon: "fa-server",
      fn: function () {
        return [{ text: "piotrunius.dev" }];
      },
    },

    curl: {
      description: "Fetch URL content (simulated)",
      usage: "curl <url>",
      icon: "fa-download",
      fn: async function (args) {
        const url = args[0];
        if (!url) {
          return [{ text: "Usage: curl <url>", class: "warning" }];
        }

        Terminal.print([{ text: `Fetching ${url}...`, class: "system" }]);

        try {
          const response = await fetch(url);
          const text = await response.text();
          const preview = text.substring(0, 500);

          return [
            {
              text: `HTTP ${response.status} ${response.statusText}`,
              class: response.ok ? "success" : "error",
            },
            { text: "" },
            { text: preview + (text.length > 500 ? "..." : "") },
          ];
        } catch (e) {
          return [
            {
              text: `curl: (6) Could not resolve host: ${url}`,
              class: "error",
            },
          ];
        }
      },
    },

    man: {
      description: "Display manual for a command",
      usage: "man <command>",
      icon: "fa-book",
      fn: function (args) {
        const cmdName = args[0]?.toLowerCase();
        if (!cmdName) {
          return [{ text: "What manual page do you want?", class: "warning" }];
        }

        const cmd = Terminal.commands[cmdName];
        if (!cmd) {
          return [{ text: `No manual entry for ${cmdName}`, class: "error" }];
        }

        return [
          { text: `${cmdName.toUpperCase()}(1)`, class: "highlight" },
          { text: "" },
          { text: "NAME", class: "info" },
          { text: `       ${cmdName} - ${cmd.description}` },
          { text: "" },
          { text: "SYNOPSIS", class: "info" },
          { text: `       ${cmd.usage}` },
          { text: "" },
          { text: "DESCRIPTION", class: "info" },
          { text: `       ${cmd.description}` },
          { text: "" },
        ];
      },
    },

    screenfetch: {
      description: "Alias for neofetch",
      usage: "screenfetch",
      icon: "fa-desktop",
      fn: function () {
        return Terminal.commands.neofetch.fn();
      },
    },

    tictactoe: {
      description: "Play Tic Tac Toe",
      usage: "tictactoe [1-9]",
      icon: "fa-th",
      fn: function (args) {
        if (!Terminal.tttGame) {
          Terminal.tttGame = {
            board: [" ", " ", " ", " ", " ", " ", " ", " ", " "],
            player: "X",
            computer: "O",
            gameOver: false,
          };
          return [
            { text: "[GAME] Tic Tac Toe - You are X", class: "success" },
            { text: "" },
            { text: "  1 | 2 | 3" },
            { text: " ---+---+---" },
            { text: "  4 | 5 | 6" },
            { text: " ---+---+---" },
            { text: "  7 | 8 | 9" },
            { text: "" },
            { text: 'Type "tictactoe <1-9>" to make a move.', class: "system" },
          ];
        }

        if (args[0] === "reset") {
          Terminal.tttGame = null;
          return [
            {
              text: 'Game reset. Type "tictactoe" to start new game.',
              class: "success",
            },
          ];
        }

        const pos = parseInt(args[0]) - 1;
        const g = Terminal.tttGame;

        if (g.gameOver) {
          return [
            {
              text: 'Game over! Type "tictactoe reset" to play again.',
              class: "warning",
            },
          ];
        }

        if (isNaN(pos) || pos < 0 || pos > 8 || g.board[pos] !== " ") {
          return [
            {
              text: "Invalid move! Choose an empty position 1-9.",
              class: "error",
            },
          ];
        }

        // Player move
        g.board[pos] = g.player;

        // Check for winner
        const checkWin = (b, p) => {
          const wins = [
            [0, 1, 2],
            [3, 4, 5],
            [6, 7, 8],
            [0, 3, 6],
            [1, 4, 7],
            [2, 5, 8],
            [0, 4, 8],
            [2, 4, 6],
          ];
          return wins.some(
            (w) => b[w[0]] === p && b[w[1]] === p && b[w[2]] === p,
          );
        };

        const displayBoard = () => [
          { text: `  ${g.board[0]} | ${g.board[1]} | ${g.board[2]}` },
          { text: " ---+---+---" },
          { text: `  ${g.board[3]} | ${g.board[4]} | ${g.board[5]}` },
          { text: " ---+---+---" },
          { text: `  ${g.board[6]} | ${g.board[7]} | ${g.board[8]}` },
        ];

        if (checkWin(g.board, g.player)) {
          g.gameOver = true;
          return [
            ...displayBoard(),
            { text: "" },
            { text: "You win!", class: "success" },
          ];
        }

        // Computer move
        const empty = g.board
          .map((v, i) => (v === " " ? i : -1))
          .filter((i) => i >= 0);
        if (empty.length === 0) {
          g.gameOver = true;
          return [
            ...displayBoard(),
            { text: "" },
            { text: "It's a tie!", class: "warning" },
          ];
        }

        const compMove = empty[Math.floor(Math.random() * empty.length)];
        g.board[compMove] = g.computer;

        if (checkWin(g.board, g.computer)) {
          g.gameOver = true;
          return [
            ...displayBoard(),
            { text: "" },
            { text: "Computer wins!", class: "error" },
          ];
        }

        if (!g.board.includes(" ")) {
          g.gameOver = true;
          return [
            ...displayBoard(),
            { text: "" },
            { text: "It's a tie!", class: "warning" },
          ];
        }

        return displayBoard();
      },
    },
  },

  // Helper methods
  getNode: function (path) {
    const parts = path.split("/").filter(Boolean);
    let node = this.fileSystem["~"];

    for (const part of parts) {
      if (part === "~") continue;
      if (!node.children || !node.children[part]) return null;
      node = node.children[part];
    }

    return node;
  },

  buildTree: function (node, prefix, output) {
    if (!node.children) return;
    const entries = Object.entries(node.children);
    entries.forEach(([name, item], index) => {
      const isLast = index === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const isDir = item.type === "dir";
      output.push({
        text:
          prefix +
          connector +
          (isDir ? `<span class="info">${name}/</span>` : name),
        html: true,
      });
      if (isDir) {
        this.buildTree(item, prefix + (isLast ? "    " : "│   "), output);
      }
    });
  },

  updatePromptPath: function () {
    const pathEl = document.querySelector(".prompt-path");
    const cwdEl = document.getElementById("terminal-cwd");
    if (pathEl) pathEl.textContent = this.currentPath;
    if (cwdEl) cwdEl.textContent = this.currentPath;
  },

  // Validate command arguments
  validateArgs: function (args, minRequired = 0, maxAllowed = Infinity) {
    if (args.length < minRequired) {
      return {
        valid: false,
        error: `Expected at least ${minRequired} argument(s), got ${args.length}`,
      };
    }
    if (args.length > maxAllowed) {
      return {
        valid: false,
        error: `Expected at most ${maxAllowed} argument(s), got ${args.length}`,
      };
    }
    return { valid: true };
  },

  // Safely parse numbers from arguments
  parseNumber: function (value, defaultVal = 0) {
    const num = parseInt(value, 10);
    return isNaN(num) ? defaultVal : num;
  },

  // Safely handle async command results
  executeAsyncCommand: async function (commandFn, args) {
    try {
      const result = await commandFn(args);
      return result || [];
    } catch (error) {
      return [
        { text: `Error executing command: ${error.message}`, class: "error" },
      ];
    }
  },

  // Execute hack sequence with typing effect
  executeHackSequence: function (target, steps) {
    const output = [];
    output.push({
      text: `[ROOT] Initiating hack on ${target}...`,
      class: "warning",
    });
    output.push({ text: "" });

    let delay = 0;
    steps.forEach((step, i) => {
      setTimeout(() => {
        Terminal.print([
          { text: `  [${i + 1}/${steps.length}] ${step}`, class: "info" },
        ]);

        // Progress bar
        const progress = Math.floor(((i + 1) / steps.length) * 20);
        const bar =
          "[" + "#".repeat(progress) + "-".repeat(20 - progress) + "]";
        Terminal.print([
          {
            text: `  ${bar} ${Math.floor(((i + 1) / steps.length) * 100)}%`,
            class: "system",
          },
        ]);

        if (i === steps.length - 1) {
          setTimeout(() => {
            Terminal.print([
              { text: "" },
              {
                text: `[SUCCESS] ${target} HACKED SUCCESSFULLY!`,
                class: "success",
              },
              {
                text: "[!] Remember: This is just a simulation!",
                class: "warning",
              },
            ]);
          }, 500);
        }
      }, delay);
      delay += 800;
    });

    return output;
  },

  // Print output to terminal
  print: function (lines) {
    const output = document.getElementById("terminal-output");
    if (!output || !Array.isArray(lines)) return;

    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();

    lines.forEach((line) => {
      if (!line) return;

      const div = document.createElement("div");
      div.className = `terminal-line ${line.class || "output"}`;

      try {
        if (line.html) {
          div.innerHTML = line.text || "";
        } else {
          div.textContent = String(line.text || "");
        }
      } catch (e) {
        div.textContent = "[Error rendering line]";
      }

      fragment.appendChild(div);
    });

    output.appendChild(fragment);

    // Scroll to bottom with smooth behavior
    requestAnimationFrame(() => {
      output.scrollTop = output.scrollHeight;
    });
  },

  // Execute command
  execute: function (input) {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Add to history
    this.commandHistory.push(trimmed);
    this.historyIndex = this.commandHistory.length;
    this.commandCount++;

    // Update command count
    const countEl = document.getElementById("terminal-cmd-count");
    if (countEl) countEl.textContent = `${this.commandCount} commands`;

    // Parse command with better regex
    const parts = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const cmdName = parts[0]?.toLowerCase();

    // Track command execution
    if (window.umami && cmdName) {
      try {
        window.umami.track("Terminal Command", { command: cmdName });
      } catch (e) {
        // Umami tracking failed silently
      }
    }

    // Check if root mode (Konami active)
    const isRoot =
      typeof KonamiEasterEgg !== "undefined" && KonamiEasterEgg.activated;
    const userName = isRoot ? "root" : "guest";
    const promptSymbol = isRoot ? "#" : "$";
    const userClass = isRoot ? "prompt-root" : "prompt-user";

    // Print command
    this.print([
      {
        text: `<span class="${userClass}">${userName}</span><span class="prompt-at">@</span><span class="prompt-host">piotrunius.dev</span><span class="prompt-colon">:</span><span class="prompt-path">${this.currentPath}</span><span class="prompt-symbol">${promptSymbol}</span> <span class="cmd-text">${escapeHtml(trimmed)}</span>`,
        class: "cmd",
        html: true,
      },
    ]);

    // Parse command and arguments
    let actualCmdName = parts[0]?.toLowerCase();
    const args = parts.slice(1).map((a) => a.replace(/^"|"$/g, ""));

    // Check for alias expansion
    if (this.aliases[actualCmdName]) {
      const aliasCmd = this.aliases[actualCmdName];
      const aliasParts = aliasCmd.split(" ");
      actualCmdName = aliasParts[0];
      args.unshift(...aliasParts.slice(1));
    }

    // Execute command with better error handling
    const cmd = this.commands[actualCmdName];
    if (cmd && typeof cmd.fn === "function") {
      try {
        const result = cmd.fn(args);
        if (result instanceof Promise) {
          result
            .then((lines) => {
              if (lines && Array.isArray(lines) && lines.length > 0) {
                this.print(lines);
              }
            })
            .catch((error) => {
              this.print([
                {
                  text: `Command error: ${error.message || "Unknown error"}`,
                  class: "error",
                },
              ]);
            });
        } else if (result && Array.isArray(result) && result.length > 0) {
          this.print(result);
        }
      } catch (error) {
        this.print([
          {
            text: `Error executing command: ${error.message || "Unknown error"}`,
            class: "error",
          },
        ]);
      }
    } else if (cmdName) {
      this.print([
        {
          text: `Command not found: ${cmdName}. Type "help" for available commands.`,
          class: "error",
        },
      ]);
    }
  },

  // Get welcome message
  getWelcomeMessage: function () {
    return [
      { text: "", class: "" },
      {
        text: "+=====================================================================+",
        class: "highlight",
      },
      {
        text: "|                                                                     |",
        class: "highlight",
      },
      {
        text: "|   ██████╗ ██╗ ██████╗ ████████╗██████╗ ██╗   ██╗███╗   ██╗██╗      |",
        class: "highlight",
      },
      {
        text: "|   ██╔══██╗██║██╔═══██╗╚══██╔══╝██╔══██╗██║   ██║████╗  ██║██║      |",
        class: "highlight",
      },
      {
        text: "|   ██████╔╝██║██║   ██║   ██║   ██████╔╝██║   ██║██╔██╗ ██║██║      |",
        class: "highlight",
      },
      {
        text: "|   ██╔═══╝ ██║██║   ██║   ██║   ██╔══██╗██║   ██║██║╚██╗██║██║      |",
        class: "highlight",
      },
      {
        text: "|   ██║     ██║╚██████╔╝   ██║   ██║  ██║╚██████╔╝██║ ╚████║██║      |",
        class: "highlight",
      },
      {
        text: "|   ╚═╝     ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝      |",
        class: "highlight",
      },
      {
        text: "|                                                                     |",
        class: "highlight",
      },
      {
        text: "|                    ADVANCED WEB TERMINAL v2.0                       |",
        class: "highlight",
      },
      {
        text: "+=====================================================================+",
        class: "highlight",
      },
      { text: "" },
      {
        text: "  Welcome to Piotrunius's interactive terminal!",
        class: "success",
      },
      { text: "" },
      { text: "  Quick Start:", class: "info" },
      { text: '    - Type "help" to see all available commands' },
      { text: '    - Type "about" to learn more about me' },
      { text: '    - Type "projects" to see my work' },
      { text: '    - Type "skills" to view my tech stack' },
      { text: "" },
      {
        text: "  Tips: Use Tab for autocomplete, UP/DOWN for history",
        class: "system",
      },
      { text: '        Try "matrix" or "neofetch" for fun!', class: "system" },
      { text: "" },
    ];
  },

  // Initialize terminal
  init: function () {
    const toggle = document.getElementById("terminal-toggle");
    const container = document.getElementById("terminal-container");
    const input = document.getElementById("terminal-input");
    const closeBtn = document.getElementById("terminal-close");
    const minimizeBtn = document.getElementById("terminal-minimize");
    const maximizeBtn = document.getElementById("terminal-maximize");
    const clearBtn = document.getElementById("terminal-clear-btn");
    const fullscreenBtn = document.getElementById("terminal-fullscreen-btn");
    const opacitySlider = document.getElementById("terminal-opacity-slider");
    const header = document.querySelector(".terminal-header");
    const suggestions = document.getElementById("terminal-suggestions");

    if (!toggle || !container || !input) return;

    // Opacity slider
    if (opacitySlider) {
      // Load saved opacity
      const savedOpacity = localStorage.getItem("terminalOpacity") || "98";
      opacitySlider.value = savedOpacity;
      this.updateOpacity(savedOpacity);

      opacitySlider.addEventListener("input", (e) => {
        const opacity = e.target.value;
        this.updateOpacity(opacity);
        localStorage.setItem("terminalOpacity", opacity);
      });

      // Prevent slider from triggering drag
      opacitySlider.addEventListener("mousedown", (e) => e.stopPropagation());
      opacitySlider.addEventListener("touchstart", (e) => e.stopPropagation());
    }

    // Toggle terminal
    toggle.addEventListener("click", () => {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    });

    // Close button
    closeBtn?.addEventListener("click", () => this.close());

    // Minimize button
    minimizeBtn?.addEventListener("click", () => {
      this.isMinimized = !this.isMinimized;
      container.classList.toggle("minimized", this.isMinimized);
    });

    // Maximize button
    maximizeBtn?.addEventListener("click", () => {
      this.isFullscreen = !this.isFullscreen;
      container.classList.toggle("fullscreen", this.isFullscreen);
    });

    // Clear button
    clearBtn?.addEventListener("click", () => {
      document.getElementById("terminal-output").innerHTML = "";
    });

    // Fullscreen button
    fullscreenBtn?.addEventListener("click", () => {
      this.isFullscreen = !this.isFullscreen;
      container.classList.toggle("fullscreen", this.isFullscreen);
      fullscreenBtn.querySelector("i").className = this.isFullscreen
        ? "fas fa-compress"
        : "fas fa-expand";
    });

    // Input handling
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.execute(input.value);
        input.value = "";
        this.hideSuggestions();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (this.historyIndex > 0) {
          this.historyIndex--;
          input.value = this.commandHistory[this.historyIndex];
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (this.historyIndex < this.commandHistory.length - 1) {
          this.historyIndex++;
          input.value = this.commandHistory[this.historyIndex];
        } else {
          this.historyIndex = this.commandHistory.length;
          input.value = "";
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        this.autocomplete(input.value);
      } else if (e.key === "Escape") {
        this.hideSuggestions();
      } else if (e.key === "l" && e.ctrlKey) {
        e.preventDefault();
        this.commands.clear.fn();
      }
    });

    // Show suggestions on input
    input.addEventListener("input", () => {
      this.showSuggestions(input.value);
    });

    // Draggable header
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    header?.addEventListener("mousedown", (e) => {
      if (this.isFullscreen) return;
      isDragging = true;
      dragOffset.x = e.clientX - container.offsetLeft;
      dragOffset.y = e.clientY - container.offsetTop;
      container.style.transition = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const x = Math.max(
        0,
        Math.min(
          window.innerWidth - container.offsetWidth,
          e.clientX - dragOffset.x,
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          window.innerHeight - container.offsetHeight,
          e.clientY - dragOffset.y,
        ),
      );
      container.style.left = x + "px";
      container.style.top = y + "px";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
      container.style.transition = "";
    });

    // Update terminal time
    setInterval(() => {
      const timeEl = document.getElementById("terminal-time");
      if (timeEl) {
        timeEl.textContent = new Date().toLocaleTimeString("en-GB");
      }
    }, 1000);

    // Close terminal on Escape if open
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen && !this.isFullscreen) {
        this.close();
      }
      // Open terminal with Ctrl+`
      if (e.key === "`" && e.ctrlKey) {
        e.preventDefault();
        if (this.isOpen) {
          this.close();
        } else {
          this.open();
        }
      }
    });
  },

  open: function () {
    const container = document.getElementById("terminal-container");
    const toggle = document.getElementById("terminal-toggle");
    const input = document.getElementById("terminal-input");

    this.isOpen = true;
    container?.classList.add("visible");
    toggle?.classList.add("active");

    // Show welcome message on first open
    const output = document.getElementById("terminal-output");
    if (output && output.children.length === 0) {
      this.print(this.getWelcomeMessage());
    }

    // Track terminal open
    if (window.umami) {
      window.umami.track("Terminal Opened");
    }

    // Focus input
    setTimeout(() => input?.focus(), 100);
  },

  close: function () {
    const container = document.getElementById("terminal-container");
    const toggle = document.getElementById("terminal-toggle");

    this.isOpen = false;
    container?.classList.remove("visible");
    toggle?.classList.remove("active");

    // Track terminal close
    if (window.umami) {
      window.umami.track("Terminal Closed", {
        commandsExecuted: this.commandCount,
      });
    }

    // Stop matrix if running
    if (this.matrixInterval) {
      clearInterval(this.matrixInterval);
      this.matrixInterval = null;
      const rain = document.querySelector(".matrix-rain");
      if (rain) rain.remove();
    }
  },

  showSuggestions: function (input) {
    const suggestionsEl = document.getElementById("terminal-suggestions");
    if (!suggestionsEl) return;

    const trimmedInput = input.trim().toLowerCase();
    if (!trimmedInput) {
      this.hideSuggestions();
      return;
    }

    const matches = Object.entries(this.commands)
      .filter(([name, cmd]) => !cmd.hidden && name.startsWith(trimmedInput))
      .slice(0, 8);

    if (matches.length === 0) {
      this.hideSuggestions();
      return;
    }

    // Use fragment for better performance
    const fragment = document.createDocumentFragment();
    matches.forEach(([name, cmd]) => {
      const item = document.createElement("div");
      item.className = "suggestion-item";
      item.dataset.cmd = name;
      item.innerHTML = `
                <i class="fas ${cmd.icon || "fa-terminal"}"></i>
                <span class="suggestion-cmd">${escapeHtml(name)}</span>
                <span class="suggestion-desc">${escapeHtml(cmd.description.substring(0, 30))}...</span>
            `;
      fragment.appendChild(item);
    });

    suggestionsEl.innerHTML = "";
    suggestionsEl.appendChild(fragment);
    suggestionsEl.classList.add("visible");
  },

  hideSuggestions: function () {
    const suggestionsEl = document.getElementById("terminal-suggestions");
    suggestionsEl?.classList.remove("visible");
  },

  autocomplete: function (input) {
    const parts = input.trim().split(" ");
    const partial = parts[parts.length - 1].toLowerCase();

    if (parts.length === 1) {
      // Command autocomplete
      const matches = Object.keys(this.commands).filter((c) =>
        c.startsWith(partial),
      );
      if (matches.length === 1) {
        document.getElementById("terminal-input").value = matches[0] + " ";
      } else if (matches.length > 1) {
        this.print([{ text: matches.join("  "), class: "info" }]);
      }
    } else {
      // Path autocomplete
      const node = this.getNode(this.currentPath);
      if (node?.children) {
        const matches = Object.keys(node.children).filter((f) =>
          f.startsWith(partial),
        );
        if (matches.length === 1) {
          parts[parts.length - 1] = matches[0];
          document.getElementById("terminal-input").value =
            parts.join(" ") + " ";
        } else if (matches.length > 1) {
          this.print([{ text: matches.join("  "), class: "info" }]);
        }
      }
    }

    this.hideSuggestions();
  },

  updateOpacity: function (value) {
    const container = document.getElementById("terminal-container");
    if (!container) return;

    const opacity = value / 100;
    // Update the background color opacity while keeping other styles
    container.style.background = `rgba(10, 15, 20, ${opacity})`;
  },
};

// ==========================================
// KONAMI CODE EASTER EGG
// ==========================================
const KonamiEasterEgg = {
  code: [
    "ArrowUp",
    "ArrowUp",
    "ArrowDown",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowLeft",
    "ArrowRight",
    "KeyB",
    "KeyA",
  ],
  index: 0,
  activated: false,
  matrixCanvas: null,
  matrixCtx: null,
  matrixAnimationId: null,
  glitchInterval: null,
  shakeInterval: null,
  colorCycleInterval: null,
  countdownInterval: null,
  timeLeft: 60,

  init: function () {
    document.addEventListener("keydown", (e) => this.handleKey(e));
  },

  handleKey: function (e) {
    if (this.activated) return;

    // Don't trigger Konami code if terminal input is focused
    const terminalInput = document.getElementById("terminal-input");
    if (terminalInput && document.activeElement === terminalInput) {
      return;
    }

    if (e.code === this.code[this.index]) {
      this.index++;
      this.flashScreen();
      this.playKeySound();

      if (this.index === this.code.length) {
        // Track Konami Code activation
        if (window.umami) {
          window.umami.track("Konami Code Activated");
        }
        this.activate();
        this.index = 0;
      }
    } else {
      if (this.index > 0) this.playErrorSound();
      this.index = 0;
    }
  },

  flashScreen: function () {
    const flash = document.createElement("div");
    flash.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 255, 136, ${0.1 + this.index * 0.05});
            pointer-events: none;
            z-index: 9999999;
            animation: konamiFlash 0.2s ease-out forwards;
        `;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 200);

    // Progress indicator
    const progress =
      document.getElementById("konami-progress") ||
      this.createProgressIndicator();
    progress.style.width = `${(this.index / this.code.length) * 100}%`;
    progress.parentElement.style.opacity = "1";

    clearTimeout(this.progressTimeout);
    this.progressTimeout = setTimeout(() => {
      if (progress.parentElement) progress.parentElement.style.opacity = "0";
    }, 2000);
  },

  createProgressIndicator: function () {
    const container = document.createElement("div");
    container.id = "konami-progress-container";
    container.innerHTML = '<div id="konami-progress"></div>';
    document.body.appendChild(container);
    return document.getElementById("konami-progress");
  },

  playKeySound: function () {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.value = 440 + this.index * 80;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {}
  },

  playErrorSound: function () {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sawtooth";
      osc.frequency.value = 150;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  },

  activate: function () {
    this.activated = true;
    this.timeLeft = 60;

    document.getElementById("konami-progress-container")?.remove();

    this.playActivationSound();
    this.showHackerOverlay();

    setTimeout(() => {
      this.startMatrixRain();
      this.startGlitchEffect();
      this.startScreenShake();
      this.startColorCycle();
      this.applyHackerMode();
      this.showSecretMessage();
      this.invertImages();
      this.scrambleText();
    }, 3500);
  },

  playActivationSound: function () {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();

      // Epic arpeggio
      const notes = [
        261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5, 1318.51,
      ];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "square";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.08);
        gain.gain.exponentialDecayTo &&
          gain.gain.exponentialDecayTo(0.01, ctx.currentTime + i * 0.08 + 0.2);
        osc.start(ctx.currentTime + i * 0.08);
        osc.stop(ctx.currentTime + i * 0.08 + 0.2);
      });

      // Bass drop
      setTimeout(() => {
        const bass = ctx.createOscillator();
        const bassGain = ctx.createGain();
        bass.connect(bassGain);
        bassGain.connect(ctx.destination);
        bass.type = "sine";
        bass.frequency.setValueAtTime(80, ctx.currentTime);
        bass.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.5);
        bassGain.gain.setValueAtTime(0.3, ctx.currentTime);
        bassGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        bass.start(ctx.currentTime);
        bass.stop(ctx.currentTime + 0.5);
      }, 700);
    } catch (e) {}
  },

  showHackerOverlay: function () {
    const overlay = document.createElement("div");
    overlay.id = "konami-overlay";
    overlay.innerHTML = `
            <div class="konami-boot">
                <div class="boot-terminal">
                    <div class="boot-line">> INTERCEPTING SIGNAL...</div>
                    <div class="boot-line">> DECRYPTING PAYLOAD... [########----] 67%</div>
                    <div class="boot-line">> BYPASSING FIREWALL...</div>
                    <div class="boot-line">> INJECTING SHELLCODE...</div>
                    <div class="boot-line">> ESCALATING PRIVILEGES...</div>
                    <div class="boot-line">> DISABLING SECURITY PROTOCOLS...</div>
                    <div class="boot-line success">> ROOT ACCESS OBTAINED</div>
                    <div class="boot-line hack">> INITIATING HACKER MODE...</div>
                </div>
                <div class="boot-ascii">
    ██╗  ██╗ █████╗  ██████╗██╗  ██╗███████╗██████╗
    ██║  ██║██╔══██╗██╔════╝██║ ██╔╝██╔════╝██╔══██╗
    ███████║███████║██║     █████╔╝ █████╗  ██║  ██║
    ██╔══██║██╔══██║██║     ██╔═██╗ ██╔══╝  ██║  ██║
    ██║  ██║██║  ██║╚██████╗██║  ██╗███████╗██████╔╝
    ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═════╝
                     MODE ACTIVATED
                </div>
                <div class="boot-warning">
                    <span class="warning-icon">[!]</span>
                    <span class="warning-text">SYSTEM COMPROMISED</span>
                </div>
            </div>
        `;
    document.body.appendChild(overlay);

    const lines = overlay.querySelectorAll(".boot-line");
    lines.forEach((line, i) => {
      line.style.animation = `bootLine 0.4s ease-out ${i * 0.3}s forwards`;
    });

    const ascii = overlay.querySelector(".boot-ascii");
    ascii.style.animation = `bootAscii 0.8s ease-out ${lines.length * 0.3 + 0.2}s forwards`;

    const warning = overlay.querySelector(".boot-warning");
    warning.style.animation = `warningBlink 0.5s ease-in-out ${lines.length * 0.3 + 1}s infinite`;

    setTimeout(() => overlay.classList.add("fade-out"), 3000);
    setTimeout(() => overlay.remove(), 3500);
  },

  startMatrixRain: function () {
    this.matrixCanvas = document.createElement("canvas");
    this.matrixCanvas.id = "matrix-rain";
    document.body.appendChild(this.matrixCanvas);

    this.matrixCtx = this.matrixCanvas.getContext("2d");
    this.matrixCanvas.width = window.innerWidth;
    this.matrixCanvas.height = window.innerHeight;

    const columns = Math.floor(this.matrixCanvas.width / 14);
    const drops = Array(columns).fill(1);
    const speeds = Array(columns)
      .fill(0)
      .map(() => Math.random() * 0.5 + 0.5);
    const chars =
      "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*<>?{}[]";

    const draw = () => {
      this.matrixCtx.fillStyle = "rgba(0, 0, 0, 0.03)";
      this.matrixCtx.fillRect(
        0,
        0,
        this.matrixCanvas.width,
        this.matrixCanvas.height,
      );

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const y = drops[i] * 14;

        // Gradient from bright to dim
        const brightness = Math.max(
          0,
          1 - (y / this.matrixCanvas.height) * 0.3,
        );
        this.matrixCtx.fillStyle = `rgba(0, 255, 136, ${brightness})`;
        this.matrixCtx.font = "14px Fira Code, monospace";
        this.matrixCtx.fillText(char, i * 14, y);

        // Head of the drop is brighter
        if (Math.random() > 0.98) {
          this.matrixCtx.fillStyle = "#ffffff";
          this.matrixCtx.fillText(char, i * 14, y);
        }

        if (y > this.matrixCanvas.height && Math.random() > 0.99) {
          drops[i] = 0;
        }
        drops[i] += speeds[i];
      }

      this.matrixAnimationId = requestAnimationFrame(draw);
    };

    draw();

    // Handle resize
    window.addEventListener("resize", () => {
      if (this.matrixCanvas) {
        this.matrixCanvas.width = window.innerWidth;
        this.matrixCanvas.height = window.innerHeight;
      }
    });
  },

  startGlitchEffect: function () {
    const glitchElements = document.querySelectorAll(
      "h1, h2, h3, .section-title, .profile-name, .stat-value, .social-link",
    );

    this.glitchInterval = setInterval(() => {
      const count = Math.floor(Math.random() * 3) + 1;
      for (let i = 0; i < count; i++) {
        const el =
          glitchElements[Math.floor(Math.random() * glitchElements.length)];
        if (el) {
          el.classList.add("konami-glitch");
          setTimeout(
            () => el.classList.remove("konami-glitch"),
            150 + Math.random() * 200,
          );
        }
      }
    }, 300);
  },

  startScreenShake: function () {
    let intensity = 0;
    this.shakeInterval = setInterval(() => {
      intensity = Math.random() > 0.7 ? Math.random() * 3 : 0;
      if (intensity > 0) {
        const x = (Math.random() - 0.5) * intensity;
        const y = (Math.random() - 0.5) * intensity;
        document.body.style.transform = `translate(${x}px, ${y}px)`;
      } else {
        document.body.style.transform = "";
      }
    }, 50);
  },

  startColorCycle: function () {
    let hue = 0;
    this.colorCycleInterval = setInterval(() => {
      hue = (hue + 2) % 360;
      document.documentElement.style.setProperty("--konami-hue", `${hue}deg`);
    }, 50);
  },

  applyHackerMode: function () {
    document.body.classList.add("konami-hacker-mode");

    // Force open terminal and lock it
    const terminalContainer = document.querySelector(".terminal-container");
    const terminalToggle = document.querySelector(".terminal-toggle");
    if (terminalContainer && !terminalContainer.classList.contains("visible")) {
      terminalContainer.classList.add("visible");
      if (terminalToggle) terminalToggle.classList.add("active");
    }

    // Hide terminal close button and toggle (lock terminal open)
    const closeBtn = document.getElementById("terminal-close");
    if (closeBtn) closeBtn.style.display = "none";
    if (terminalToggle) terminalToggle.style.display = "none";

    // Disable ESC key for terminal during Konami
    this.escKeyHandler = (e) => {
      if (e.key === "Escape" && this.activated) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", this.escKeyHandler, true);

    // Change terminal prompt to root
    const promptUser = document.querySelector(".terminal-prompt .prompt-user");
    const promptSymbol = document.querySelector(
      ".terminal-prompt .prompt-symbol",
    );
    if (promptUser) {
      promptUser.textContent = "root";
      promptUser.classList.remove("prompt-user");
      promptUser.classList.add("prompt-root");
    }
    if (promptSymbol) {
      promptSymbol.textContent = "#";
    }

    // Display root commands in terminal
    const terminalOutput = document.getElementById("terminal-output");
    if (terminalOutput) {
      const rootMessage = document.createElement("div");
      rootMessage.className = "terminal-line konami-root-message";
      rootMessage.innerHTML = `<span class="output-success">[ROOT]</span> <span class="output-highlight">Available root commands:</span>
  <span class="output-command">sudo poweroff</span>     - Initiate system shutdown
  <span class="output-command">sudo reboot</span>       - Reboot the matrix
  <span class="output-command">sudo nuke</span>         - Launch nuclear codes
  <span class="output-command">sudo selfdestruct</span> - Initiate self-destruct
  <span class="output-command">sudo matrix</span>       - Enter the Matrix
  <span class="output-command">sudo godmode</span>      - Enable god mode
  <span class="output-command">sudo unlock</span>       - Unlock all secrets
  <span class="output-command">sudo party</span>        - Start a party
  <span class="output-command">sudo rainbow</span>      - Taste the rainbow
  <span class="output-command">sudo glitch</span>       - Maximum glitch`;
      terminalOutput.appendChild(rootMessage);
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }

    // Scanlines
    const scanlines = document.createElement("div");
    scanlines.id = "konami-scanlines";
    document.body.appendChild(scanlines);

    // CRT effect
    const crt = document.createElement("div");
    crt.id = "konami-crt";
    document.body.appendChild(crt);

    // Vignette
    const vignette = document.createElement("div");
    vignette.id = "konami-vignette";
    document.body.appendChild(vignette);

    // Random "hacked" messages
    this.hackedMessagesInterval = setInterval(() => {
      if (Math.random() > 0.7) {
        this.showRandomHackedMessage();
      }
    }, 2000);
  },

  showRandomHackedMessage: function () {
    const messages = [
      "SYSTEM BREACH DETECTED",
      "FIREWALL BYPASSED",
      "DATA EXFILTRATION IN PROGRESS",
      "ENCRYPTING FILES...",
      "ACCESSING MAINFRAME",
      "PACKET INJECTION ACTIVE",
      "BACKDOOR INSTALLED",
      "KEYLOGGER ACTIVE",
      "ROOT ACCESS GRANTED",
      "TRACE BLOCKED",
    ];

    const msg = document.createElement("div");
    msg.className = "konami-hacked-msg";
    msg.textContent = `[!] ${messages[Math.floor(Math.random() * messages.length)]}`;
    msg.style.top = `${Math.random() * 70 + 10}%`;
    msg.style.left = `${Math.random() * 60 + 10}%`;
    document.body.appendChild(msg);

    setTimeout(() => msg.remove(), 2000);
  },

  invertImages: function () {
    document.querySelectorAll("img").forEach((img) => {
      img.classList.add("konami-invert");
    });
  },

  scrambleText: function () {
    const elements = document.querySelectorAll(".section-title, .stat-label");
    elements.forEach((el) => {
      if (!el.dataset.original) {
        el.dataset.original = el.textContent;
      }
    });

    this.scrambleInterval = setInterval(() => {
      elements.forEach((el) => {
        if (Math.random() > 0.8) {
          const original = el.dataset.original || el.textContent;
          const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*";
          let scrambled = "";
          for (let i = 0; i < original.length; i++) {
            scrambled +=
              Math.random() > 0.5
                ? original[i]
                : chars[Math.floor(Math.random() * chars.length)];
          }
          el.textContent = scrambled;
          setTimeout(() => {
            el.textContent = original;
          }, 100);
        }
      });
    }, 500);
  },

  showSecretMessage: function () {
    const message = document.createElement("div");
    message.id = "konami-secret";
    message.innerHTML = `
            <div class="secret-header">
                <div class="secret-title-bar">
                    <span class="secret-title-icon">[ROOT]</span>
                    <span class="secret-title-text">HACKER_MODE.exe</span>
                </div>
                <button id="konami-minimize" class="secret-btn-min">_</button>
            </div>
            <div class="secret-content">
                <div class="secret-ascii-small">
  /\\_/\\
 ( o.o )
  > ^ <  MEOW!
                </div>
                <div class="secret-status">
                    <div class="status-dot"></div>
                    <span>HACKER MODE ACTIVE</span>
                </div>
                <div class="secret-info">
                    <p>You cracked the Konami Code!</p>
                    <p class="secret-code-display">^ ^ v v < > < > B A</p>
                </div>
                <div class="secret-stats">
                    <div class="stat-row">
                        <span>Packets Injected:</span>
                        <span id="packets-count">0</span>
                    </div>
                    <div class="stat-row">
                        <span>Data Exfiltrated:</span>
                        <span id="data-count">0 KB</span>
                    </div>
                    <div class="stat-row">
                        <span>Firewalls Bypassed:</span>
                        <span id="firewall-count">0</span>
                    </div>
                </div>
                <div class="secret-progress-section">
                    <div class="secret-progress-label">
                        <span>Time Remaining:</span>
                        <span id="konami-timer">${this.timeLeft}s</span>
                    </div>
                    <div class="secret-progress-bar">
                        <div class="secret-progress-fill" id="konami-progress-fill"></div>
                    </div>
                </div>
                <button id="konami-deactivate">
                    <span class="btn-icon">[X]</span>
                    <span>TERMINATE SESSION</span>
                </button>
            </div>
        `;
    document.body.appendChild(message);

    // Fake stats counter
    let packets = 0,
      data = 0,
      firewalls = 0;
    this.statsInterval = setInterval(() => {
      packets += Math.floor(Math.random() * 100);
      data += Math.random() * 50;
      firewalls += Math.random() > 0.9 ? 1 : 0;
      document.getElementById("packets-count").textContent =
        packets.toLocaleString();
      document.getElementById("data-count").textContent =
        `${data.toFixed(1)} KB`;
      document.getElementById("firewall-count").textContent = firewalls;
    }, 200);

    // Countdown timer
    const timerEl = document.getElementById("konami-timer");
    const progressFill = document.getElementById("konami-progress-fill");
    this.countdownInterval = setInterval(() => {
      this.timeLeft--;
      if (timerEl) timerEl.textContent = `${this.timeLeft}s`;
      if (progressFill)
        progressFill.style.width = `${(this.timeLeft / 60) * 100}%`;
      if (this.timeLeft <= 0) {
        this.deactivate();
      }
    }, 1000);

    // Minimize button
    let isMinimized = false;
    document
      .getElementById("konami-minimize")
      ?.addEventListener("click", () => {
        isMinimized = !isMinimized;
        message.classList.toggle("minimized", isMinimized);
      });

    // Deactivate button
    document
      .getElementById("konami-deactivate")
      ?.addEventListener("click", () => {
        this.deactivate();
      });

    // Position panel next to terminal
    this.positionPanel(message);

    // Update position if terminal moves/resizes
    this.panelPositionObserver = new MutationObserver(() =>
      this.positionPanel(message),
    );
    const terminalContainer = document.querySelector(".terminal-container");
    if (terminalContainer) {
      this.panelPositionObserver.observe(terminalContainer, {
        attributes: true,
        attributeFilter: ["style"],
      });
    }
    window.addEventListener("resize", () => this.positionPanel(message));
  },

  positionPanel: function (panel) {
    const terminal = document.querySelector(".terminal-container");
    if (!terminal || !panel) return;

    const termRect = terminal.getBoundingClientRect();
    const panelWidth = 280;
    const gap = 10;

    // Check if panel fits to the right of terminal
    if (termRect.right + gap + panelWidth < window.innerWidth) {
      panel.style.left = `${termRect.right + gap}px`;
      panel.style.top = `${termRect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
    // If not, try left side of terminal
    else if (termRect.left - gap - panelWidth > 0) {
      panel.style.left = `${termRect.left - gap - panelWidth}px`;
      panel.style.top = `${termRect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
    // If neither, put it below terminal
    else if (termRect.bottom + gap + 300 < window.innerHeight) {
      panel.style.left = `${termRect.left}px`;
      panel.style.top = `${termRect.bottom + gap}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
    // Last resort - fixed bottom right
    else {
      panel.style.left = "auto";
      panel.style.top = "auto";
      panel.style.right = "1.5rem";
      panel.style.bottom = "1.5rem";
    }
  },

  deactivate: function () {
    this.activated = false;

    // Clear all intervals
    clearInterval(this.glitchInterval);
    clearInterval(this.shakeInterval);
    clearInterval(this.colorCycleInterval);
    clearInterval(this.countdownInterval);
    clearInterval(this.statsInterval);
    clearInterval(this.hackedMessagesInterval);
    clearInterval(this.scrambleInterval);

    // Clean up panel position observer
    if (this.panelPositionObserver) {
      this.panelPositionObserver.disconnect();
    }

    if (this.matrixAnimationId) {
      cancelAnimationFrame(this.matrixAnimationId);
    }

    // Reset body transform
    document.body.style.transform = "";
    document.documentElement.style.removeProperty("--konami-hue");

    // Remove elements
    document.getElementById("matrix-rain")?.remove();
    document.getElementById("konami-scanlines")?.remove();
    document.getElementById("konami-crt")?.remove();
    document.getElementById("konami-vignette")?.remove();
    document.getElementById("konami-secret")?.remove();
    document
      .querySelectorAll(".konami-hacked-msg")
      .forEach((el) => el.remove());

    // Remove classes
    document.body.classList.remove("konami-hacker-mode");
    document.body.classList.remove("konami-godmode");
    document.body.classList.remove("konami-rainbow");
    document.body.classList.remove("konami-max-glitch");
    document
      .querySelectorAll(".konami-invert")
      .forEach((el) => el.classList.remove("konami-invert"));
    document
      .querySelectorAll(".konami-glitch")
      .forEach((el) => el.classList.remove("konami-glitch"));

    // Restore terminal prompt
    const promptUser = document.querySelector(".terminal-prompt .prompt-root");
    const promptSymbol = document.querySelector(
      ".terminal-prompt .prompt-symbol",
    );
    if (promptUser) {
      promptUser.textContent = "guest";
      promptUser.classList.remove("prompt-root");
      promptUser.classList.add("prompt-user");
    }
    if (promptSymbol) {
      promptSymbol.textContent = "$";
    }

    // Restore terminal close button and toggle
    const closeBtn = document.getElementById("terminal-close");
    const terminalToggle = document.querySelector(".terminal-toggle");
    if (closeBtn) closeBtn.style.display = "";
    if (terminalToggle) terminalToggle.style.display = "";

    // Remove ESC key block
    if (this.escKeyHandler) {
      document.removeEventListener("keydown", this.escKeyHandler, true);
    }

    // Restore scrambled text
    document.querySelectorAll("[data-original]").forEach((el) => {
      el.textContent = el.dataset.original;
      delete el.dataset.original;
    });

    // Deactivation flash
    const flash = document.createElement("div");
    flash.style.cssText = `
            position: fixed;
            inset: 0;
            background: white;
            pointer-events: none;
            z-index: 9999999;
            animation: konamiDeactivate 0.5s ease-out forwards;
        `;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 500);

    // Play deactivation sound
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
  },
};

// FAQ accordion functionality
function initFAQ() {
  const faqQuestions = document.querySelectorAll(".faq-question");

  faqQuestions.forEach((question) => {
    question.addEventListener("click", () => {
      const isExpanded = question.getAttribute("aria-expanded") === "true";

      // Close all other FAQs
      faqQuestions.forEach((q) => {
        if (q !== question) {
          q.setAttribute("aria-expanded", "false");
        }
      });

      // Toggle current FAQ
      question.setAttribute("aria-expanded", !isExpanded);
    });
  });
}

// Service Worker update notification
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        newWorker.addEventListener("statechange", () => {
          if (
            newWorker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            ToastManager.info("New version available! Refresh to update.");
          }
        });
      });
    })
    .catch((err) => {
      console.warn("SW registration failed:", err);
    });
}

// Smooth scroll for anchor links
document.addEventListener("click", (e) => {
  const anchor = e.target.closest('a[href^="#"]');
  if (anchor && anchor.hash) {
    const target = document.querySelector(anchor.hash);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      // Don't push hash to history - prevents Umami spam
      // history.pushState(null, '', anchor.hash);
    }
  }
});

// --- PRIVACY CONTROL ---
function showPrivacyModal() {
  let overlay = document.getElementById("privacy-modal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "privacy-modal";
    overlay.className = "privacy-modal-overlay";
    overlay.innerHTML = `
      <div class="privacy-modal-content">
        <div class="privacy-modal-header">
          <i class="fas fa-shield-alt"></i>
          <h3>🔐 Privacy Control</h3>
          <p>Toggle visibility of live statuses on the site</p>
        </div>
        <div class="privacy-modal-body">
          <div class="privacy-status-text" id="privacy-modal-status">
            Checking status...
          </div>
          <div class="privacy-input-group">
            <label for="privacy-password">Admin Password</label>
            <input type="password" id="privacy-password" class="privacy-input" placeholder="••••••••" autocomplete="current-password">
          </div>
          <div class="privacy-message" id="privacy-modal-message"></div>
        </div>
        <div class="privacy-modal-actions">
          <button class="privacy-btn privacy-btn-primary" id="privacy-btn-enable">
            <i class="fas fa-eye-slash"></i> Hide Data
          </button>
          <button class="privacy-btn privacy-btn-danger" id="privacy-btn-disable">
            <i class="fas fa-eye"></i> Show Data
          </button>
          <button class="privacy-btn privacy-btn-secondary" id="privacy-btn-close">
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document
      .getElementById("privacy-btn-close")
      .addEventListener("click", () => {
        overlay.classList.remove("active");
      });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.classList.remove("active");
      }
    });

    document
      .getElementById("privacy-password")
      .addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          document.getElementById("privacy-btn-enable").click();
        }
      });

    const handleToggle = async (enable) => {
      const passwordEl = document.getElementById("privacy-password");
      const messageEl = document.getElementById("privacy-modal-message");
      const password = passwordEl.value;

      if (!password) {
        messageEl.textContent = "Please enter the password.";
        messageEl.className = "privacy-message error";
        return;
      }

      messageEl.textContent = "Updating Privacy Mode...";
      messageEl.className = "privacy-message loading";

      const buttons = overlay.querySelectorAll(".privacy-btn");
      buttons.forEach((b) => (b.disabled = true));

      try {
        const res = await fetch(
          "https://admin-control.piotrunius.workers.dev/",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              password,
              action: enable ? "enable" : "disable",
            }),
          },
        );
        const data = await res.json();
        if (data.success) {
          messageEl.textContent = `Privacy Mode ${enable ? "Enabled" : "Disabled"} successfully!`;
          messageEl.className = "privacy-message success";
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        } else {
          messageEl.textContent = data.error || "Incorrect password.";
          messageEl.className = "privacy-message error";
          buttons.forEach((b) => (b.disabled = false));
        }
      } catch (err) {
        messageEl.textContent = `Error: ${err.message}`;
        messageEl.className = "privacy-message error";
        buttons.forEach((b) => (b.disabled = false));
      }
    };

    document
      .getElementById("privacy-btn-enable")
      .addEventListener("click", () => handleToggle(true));
    document
      .getElementById("privacy-btn-disable")
      .addEventListener("click", () => handleToggle(false));
  }

  document.getElementById("privacy-password").value = "";
  const messageEl = document.getElementById("privacy-modal-message");
  messageEl.textContent = "";
  messageEl.className = "privacy-message";
  const buttons = overlay.querySelectorAll(".privacy-btn");
  buttons.forEach((b) => (b.disabled = false));

  overlay.classList.add("active");
  document.getElementById("privacy-password").focus();

  const statusEl = document.getElementById("privacy-modal-status");
  statusEl.textContent = "Checking current status...";
  statusEl.className = "privacy-status-text";

  fetch("https://github-api.piotrunius.workers.dev/")
    .then((res) => res.json())
    .then((data) => {
      const active = data.privacyMode === true;
      statusEl.textContent = `Current Status: ${active ? "ACTIVE (Live Data Hidden)" : "INACTIVE (Live Data Visible)"}`;
      statusEl.className = `privacy-status-text ${active ? "active" : "inactive"}`;
    })
    .catch(() => {
      statusEl.textContent = "Unable to fetch current status.";
      statusEl.className = "privacy-status-text";
    });
}

function initPrivacyControl() {
  // Key Combo: Ctrl + Alt + P
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      showPrivacyModal();
    }
  });

  // Footer Lock Click
  const trigger = document.getElementById("privacy-lock-trigger");
  if (trigger) {
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      showPrivacyModal();
    });
  }
}

// Initialize all new features
document.addEventListener("DOMContentLoaded", () => {
  ToastManager.init();
  initThemeDetection();
  initFAQ();
  initPrivacyControl();
});
