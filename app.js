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

    return fallback;
  }
}

async function getGitHubData(force = false) {
  const now = Date.now();
  if (!force && githubCache.data && now - githubCache.ts < GITHUB_CACHE_MS) {
    return githubCache.data;
  }
  const fallback = {
    error: true,
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
      avatar: "assets/pfp.webp",
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
  if (avatar) avatar.src = config.profile?.avatar || "assets/pfp.webp";
  if (nameEl) nameEl.textContent = config.profile?.name || "Piotrunius";
  if (bioEl && !bioEl.textContent.trim()) {
    bioEl.textContent = config.profile?.bio || "Bio";
  }
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
      '<div class="activity-item activity-empty-state"><i class="fas fa-lock"></i><span>Privacy Mode Active</span></div>';
    if (activityStarsEl) activityStarsEl.innerHTML = privacyMessage;
    if (activityCommitsEl) activityCommitsEl.innerHTML = privacyMessage;
    if (projectsEl) projectsEl.textContent = "?";
    if (commitsEl) commitsEl.textContent = "?";
    if (gistsEl) gistsEl.textContent = "?";
    if (lastUpdateEl) lastUpdateEl.textContent = "Privacy Mode Active";
    return;
  }

  // Check for API Error
  if (stats.error) {
    const errorMessage =
      '<div class="activity-item activity-empty-state"><i class="fas fa-exclamation-triangle"></i><span>Data unavailable</span></div>';
    if (activityStarsEl) activityStarsEl.innerHTML = errorMessage;
    if (activityCommitsEl) activityCommitsEl.innerHTML = errorMessage;
    if (projectsEl) projectsEl.textContent = "?";
    if (commitsEl) commitsEl.textContent = "?";
    if (gistsEl) gistsEl.textContent = "?";
    if (lastUpdateEl) lastUpdateEl.textContent = "Data unavailable";
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
  const followersCount = summary.followers ?? 0;

  // Reset to 0 and animate
  if (projectsEl) {
    projectsEl.textContent = "0";
    animateCounter("stat-projects", projectsCount || 0, 1500);
  }
  if (gistsEl) {
    // The "gists" stat card is repurposed to show followers count
    gistsEl.textContent = "0";
    animateCounter("stat-gists", followersCount || 0, 1500);
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
      '<div class="activity-item activity-empty-state"><i class="fas fa-star"></i><span>No recent stars</span></div>';
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
      '<div class="activity-item activity-empty-state"><i class="fas fa-code-commit"></i><span>No recent commits</span></div>';
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

// --- REVEAL ALL STATUSES SYNCHRONOUSLY ---
async function revealAllStatuses() {
  const startTime = Date.now();

  // Wait for all three API calls to settle (success or fail)
  await Promise.allSettled([
    refreshSteamStatus(),
    refreshDiscordStatus(),
    refreshRobloxStatus(),
  ]);

  // Ensure minimum ghost loader display time of 600ms across all 3
  const elapsed = Date.now() - startTime;
  if (elapsed < 600) {
    await new Promise((r) => setTimeout(r, 600 - elapsed));
  }

  // Reveal all panels together
  ["steam", "discord", "roblox"].forEach((platform) => {
    const skeleton = document.getElementById(`${platform}-skeleton`);
    const content = document.getElementById(`${platform}-content`);
    if (skeleton) skeleton.style.display = "none";
    if (content) content.style.display = "flex";
  });
}

// --- CORE FUNCTION: Render Steam Status ---
async function refreshSteamStatus() {
  const steamPanel = document.getElementById("steam-status-panel");
  if (!steamPanel) return;

  const fallback = {
    error: true,
    steam: { personastate: -1, gameextrainfo: null },
  };
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

  // Check for API Error
  if (stats.error) {
    const statusText = document.getElementById("steam-status-text");
    if (statusText) statusText.textContent = "Offline";
    const dotContainer = document.getElementById("steam-dot")?.parentElement;
    if (dotContainer) dotContainer.className = "steam-avatar-wrapper offline";
    hideLoadingSpinner("steam-status-panel");
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
        steamPfp.src = "assets/pfp.webp";
      };
    } else {
      console.warn("Invalid Steam avatar URL detected:", avatarUrl);
      steamPfp.src = "assets/pfp.webp";
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
    if (gameInfo) gameInfo.style.display = "none";
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
  } catch (e) {
    console.warn("Error fetching Discord status from Lanyard:", e.message);
    // Fallback
    if (discordStatus) discordStatus.textContent = "Offline";
    if (discordAvatarWrapper)
      discordAvatarWrapper.className = "discord-avatar-wrapper offline";
    if (discordDot) discordDot.className = "status-dot";
  }

  // Show panel after data is loaded
  if (discordPanel) discordPanel.style.display = "flex";
}

// --- ROBLOX STATUS ---
async function refreshRobloxStatus() {
  const robloxPanel = document.getElementById("roblox-status-panel");
  if (!robloxPanel) return;

  const fallback = { error: true, status: "?", game: null };
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

  if (data.error) {
    const statusText = document.getElementById("roblox-status-text");
    if (statusText) statusText.textContent = "Offline";
    const avatarWrapper = document.querySelector(".roblox-avatar-wrapper");
    if (avatarWrapper)
      avatarWrapper.className = "roblox-avatar-wrapper offline";
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
  const text = config.profile?.bio;
  if (text && bioEl.textContent !== text) {
    bioEl.textContent = text;
  }
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
let projectsConfig = null;

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
  await loadProjectsConfig();
  initProfile();
  initSocials();
  initMusicMeta();
  initSetup();
  refreshGitHubStats();
  revealAllStatuses();
  updateSpotifyStatus();
  initControls();

  // Initialize particles only after capability detection
  initParticles();

  initScrollReveal();
  initTypingEffect();
  initMouseEffects();
  initVisibilityOptimization();
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

// --- PROJECTS CONFIG ---
async function loadProjectsConfig() {
  try {
    const resp = await fetch("projects.json");
    if (resp.ok) {
      projectsConfig = await resp.json();
    }
  } catch (e) {
    console.warn("Failed to load projects config:", e.message);
  }
}

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

    // If config exists, use it as source of truth for visibility and order
    if (projectsConfig && Array.isArray(projectsConfig.projects)) {
      const configMap = new Map(
        projectsConfig.projects.map((p) => [p.repo, p]),
      );

      return repos
        .filter((repo) => configMap.has(repo.name))
        .map((repo) => {
          const cfg = configMap.get(repo.name);
          return {
            ...repo,
            displayType: cfg.type || "active",
            displayOrder: cfg.order ?? 999,
          };
        })
        .sort((a, b) => a.displayOrder - b.displayOrder);
    }

    // Fallback: no config, show all public non-fork repos
    return repos
      .filter((repo) => !repo.fork)
      .sort((a, b) => a.name.localeCompare(b.name));
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
                <div style="grid-column: 1/-1;" class="activity-empty-state">
                    <i class="fas fa-lock"></i>
                    <p>Privacy Mode Active</p>
                </div>
            `;
      return;
    }

    // Now safely check if it's an array with repos
    if (!Array.isArray(allRepos) || allRepos.length === 0) {
      container.innerHTML = `
                <div style="grid-column: 1/-1;" class="activity-empty-state">
                    <i class="fas fa-code"></i>
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
      const projectLink = repo.url;

      // Badge from config-driven displayType
      const badge = repo.displayType || "active";
      const badgeClass = `project-badge-${badge}`;

      card.innerHTML = `
                <div class="project-header">
                    <div class="project-title">${escapeHtml(repo.name)}</div>
                    ${badge ? `<span class="project-badge ${badgeClass}">${badge}</span>` : ""}
                </div>
                <div class="project-description">${escapeHtml(description)}</div>
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

function updateCopyrightYear() {
  const copyrightEl = document.getElementById("copyright-year");
  if (!copyrightEl) return;
  const currentYear = new Date().getFullYear();
  copyrightEl.textContent = `\u00a9 ${currentYear} Piotrunius \u00b7 MIT License`;
}

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
            console.info("New version available. Refresh to update.");
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
async function showPrivacyModal() {
  const password = prompt("Enter admin password:");
  if (!password) return;

  try {
    const statusRes = await fetch("https://github-api.piotrunius.workers.dev/");
    const statusData = await statusRes.json();
    const action = statusData.privacyMode === true ? "disable" : "enable";

    const res = await fetch("https://admin-control.piotrunius.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, action }),
    });
    const data = await res.json();
    if (data.success) window.location.reload();
  } catch {}
}

function initPrivacyControl() {
  const copyright = document.getElementById("copyright-year");
  if (copyright) {
    copyright.style.userSelect = "none";
    copyright.style.webkitUserSelect = "none";
    copyright.addEventListener("dblclick", (e) => {
      e.preventDefault();
      showPrivacyModal();
    });
  }
}

// --- CLIPBOARD COPY WITH SUBTLE FEEDBACK ---
function initClipboardCopy() {
  // Discord button copy handle
  const discordLinks = document.querySelectorAll('a[href*="discord.com"]');
  discordLinks.forEach((link) => {
    link.addEventListener("click", () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText("alciaforlife").catch(() => {});
        const label = link.querySelector("span") || link;
        const originalText = label.textContent;
        label.textContent = "Copied!";
        link.style.borderColor = "var(--primary)";
        setTimeout(() => {
          label.textContent = originalText;
          link.style.borderColor = "";
        }, 1500);
      }
    });
  });

  // Email button copy email
  const emailLinks = document.querySelectorAll('a[href^="mailto:"]');
  emailLinks.forEach((link) => {
    link.addEventListener("click", () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText("contact@piotrunius.dev").catch(() => {});
        const label = link.querySelector("span") || link;
        const originalText = label.textContent;
        label.textContent = "Copied!";
        link.style.borderColor = "var(--primary)";
        setTimeout(() => {
          label.textContent = originalText;
          link.style.borderColor = "";
        }, 1500);
      }
    });
  });
}

// Initialize all new features
document.addEventListener("DOMContentLoaded", () => {
  initThemeDetection();
  initFAQ();
  initPrivacyControl();
  initClipboardCopy();
});
