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
    summary: { projects: 0, followers: 0, commits: 0 },
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
  perfTier: 2, // operative tier (0-3), may be lowered by the FPS watchdog
  baseTier: 2, // tier derived purely from hardware/connection hints
  isLowEnd: false, // legacy alias: perfTier <= 1
  isMobile: false,
  memoryLimit: 4,
  connectionSpeed: "fast",
  cores: 2,
};

// Per-tier tuning. Values are chosen so lower tiers degrade gracefully
// (fewer particles, softer layers, slower refresh, lighter visualizer)
// instead of a blunt "weak device = everything off".
const PERF = {
  3: {
    particles: 120,
    bgLayer: "full",
    blur: 16,
    glassAnim: "full",
    hover: true,
    visStep: 1,
    intervals: [300000, 60000, 30000],
    typing: true,
  },
  2: {
    particles: 100,
    bgLayer: "full",
    blur: 16,
    glassAnim: "full",
    hover: true,
    visStep: 1,
    intervals: [300000, 60000, 30000],
    typing: true,
  },
  1: {
    particles: 60,
    bgLayer: "soft",
    blur: 10,
    glassAnim: "reduced",
    hover: true,
    visStep: 2,
    intervals: [600000, 120000, 60000],
    typing: true,
  },
  0: {
    particles: 0,
    bgLayer: "none",
    blur: 0,
    glassAnim: "off",
    hover: false,
    visStep: 6, // sparse bars: still shows music is playing at minimal cost
    intervals: [900000, 180000, 90000],
    typing: false,
  },
};

function gradeByCores(cores) {
  if (cores >= 5) return 3; // >=9 folded in; "many cores" is already max grade
  if (cores >= 3) return 2;
  return 1;
}

function gradeByMemory(mem) {
  if (mem >= 5) return 3;
  if (mem >= 3) return 2;
  return 1;
}

function gradeByConnection(effectiveType) {
  if (effectiveType === "4g" || effectiveType === undefined) return 2;
  if (effectiveType === "3g") return 1;
  return 0; // slow-2g / 2g
}

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
  deviceCapabilities.cores = cores;

  const memory = navigator.deviceMemory || 4; // only exposed over HTTPS in Chromium
  deviceCapabilities.memoryLimit = memory;

  const hardwareKnown =
    typeof navigator.hardwareConcurrency !== "undefined" &&
    typeof navigator.deviceMemory !== "undefined";

  const connection =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection;
  if (connection) {
    deviceCapabilities.connectionSpeed = connection.effectiveType || "4g";
  }

  // Anchor on the weakest link, then penalise slow connectivity, unknown
  // hardware and small phones so the experience scales instead of flipping.
  let tier = Math.min(
    gradeByCores(cores),
    gradeByMemory(memory),
    gradeByConnection(deviceCapabilities.connectionSpeed) + 1,
  );

  if (!hardwareKnown) {
    // Safari/Firefox hide deviceMemory/hardwareConcurrency, so punishing their
    // absence would dump every Apple-tier device into tier 0 for no real
    // reason. Hold a conservative floor instead and let the FPS watchdog score
    // the actual rendering (it can climb or drop from here freely).
    tier = Math.max(tier, 1);
  }
  if (
    deviceCapabilities.connectionSpeed === "2g" ||
    deviceCapabilities.connectionSpeed === "slow-2g"
  ) {
    tier -= 1;
  }
  // Phones thermal-throttle and share a power budget: never skip to max tier.
  if (deviceCapabilities.isMobile) tier = Math.min(tier, 2);

  deviceCapabilities.baseTier = Math.max(0, Math.min(3, tier));
  deviceCapabilities.perfTier = deviceCapabilities.baseTier;

  logPerf("caps", deviceCapabilities);
  return deviceCapabilities;
}

// Build the per-tier stylesheet and swap one <style> block when the tier
// changes. Tier 0 keeps the aggressive "low-performance" rules; tier 1 gets a
// milder "reduced" set so a modest device still sees motion, just less of it.
function buildPerfStyle(tier) {
  if (tier >= 3) return "";
  const cfg = PERF[tier];
  const blur =
    cfg.blur > 0
      ? `.perf-b .glass-card { backdrop-filter: blur(${cfg.blur}px) saturate(160%); -webkit-backdrop-filter: blur(${cfg.blur}px) saturate(160%); will-change: auto; }`
      : `.perf-o .glass-card { backdrop-filter: none; -webkit-backdrop-filter: none; }`;
  const layer =
    cfg.bgLayer === "full"
      ? ""
      : cfg.bgLayer === "soft"
        ? `
    .perf-r .bg-layer::before,
    .perf-r .bg-layer::after {
        filter: blur(40px) saturate(130%);
        opacity: 0.22;
    }`
        : `
    .perf-o .bg-layer::before,
    .perf-o .bg-layer::after {
        animation: none;
        opacity: 0.18;
    }`;
  const glassAnim =
    cfg.glassAnim === "off"
      ? `
    .perf-o .avatar,
    .perf-o .avatar-ring,
    .perf-o .stat-card i,
    .perf-o .social-link i {
        animation: none;
    }`
      : cfg.glassAnim === "reduced"
        ? `
    .perf-r .avatar,
    .perf-r .avatar-ring,
    .perf-r .stat-card i,
    .perf-r .social-link i {
        animation-duration: 1.4s;
    }`
        : "";
  const hover = cfg.hover
    ? ""
    : `.perf-o .glass-card:hover { transform: none; }`;
  return `
    ${blur}
    ${layer}
    ${glassAnim}
    ${hover}
    .perf-t .stat-card,
    .perf-t .social-link {
        transition-duration: 0.15s;
    }
  `;
}

function applyPerfTier(tier, announce) {
  deviceCapabilities.perfTier = tier;
  deviceCapabilities.isLowEnd = tier <= 1;

  const body = document.body;
  body.classList.remove(
    "perf-o",
    "perf-r",
    "perf-b",
    "perf-t",
    "low-performance",
  );
  if (tier === 0) body.classList.add("perf-o", "low-performance");
  else if (tier === 1) body.classList.add("perf-r");
  if (tier <= 2) body.classList.add("perf-b");
  body.classList.add("perf-t");

  let style = document.getElementById("perf-optimizations");
  if (!style) {
    style = document.createElement("style");
    style.id = "perf-optimizations";
    document.head.appendChild(style);
  }
  style.textContent = buildPerfStyle(tier);

  if (announce) {
    logPerf("applied perf tier " + tier, PERF[tier]);
  }
}

// Dynamic re-tiering from measured FPS while a heavy loop actually runs.
// A capable machine that is genuinely struggling drops a tier; a light one
// that has headroom steps back up. This makes the page evaluate real device
// ability instead of trusting static hardware hints alone.
function initPerfWatchdog() {
  const WINDOW_MS = 2000;
  const DOWN_THRESHOLD = 30; // sustained FPS below this -> step down a tier
  const DOWN_WINDOWS = 3; // require several bad windows to filter init noise
  const UP_THRESHOLD = 55; // sustained FPS above this -> step back up
  const UP_WINDOWS = 4; // consecutive high-FPS windows before stepping up

  let frames = 0;
  let lastTs = 0;
  let lowWindows = 0;
  let highWindows = 0;
  let armed = false;

  const heavyLoopRunning = () =>
    !document.hidden &&
    (!!particlesAnimationFrame || (audioPlaying && !!visualizerAnimationFrame));

  function sample(t) {
    frames++;
    const elapsed = t - lastTs;
    if (elapsed >= WINDOW_MS) {
      const fps = Math.round((frames * 1000) / elapsed);
      const busy = heavyLoopRunning();
      if (busy && fps < DOWN_THRESHOLD) lowWindows++;
      else lowWindows = 0;

      // Deadlock guard: on tier 0 both heavy loops are off, so `busy` stays
      // false and high-Windows would never accumulate. Any page renders light
      // here, so a clean high FPS still counts toward stepping back up.
      if (fps > UP_THRESHOLD) highWindows++;
      else highWindows = 0;

      if (lowWindows >= DOWN_WINDOWS) {
        if (deviceCapabilities.perfTier > 0) {
          applyPerfTier(deviceCapabilities.perfTier - 1, true);
          reconfigurePerfForTier();
          logPerf(
            "watchdog: stepped down to tier " + deviceCapabilities.perfTier,
          );
        }
        lowWindows = 0;
      } else if (highWindows >= UP_WINDOWS) {
        if (deviceCapabilities.perfTier < deviceCapabilities.baseTier) {
          applyPerfTier(deviceCapabilities.perfTier + 1, true);
          reconfigurePerfForTier();
          logPerf(
            "watchdog: stepped up to tier " + deviceCapabilities.perfTier,
          );
        }
        highWindows = 0;
      }

      frames = 0;
      lastTs = t;
    }
    if (armed) requestAnimationFrame(sample);
  }

  // Wait for first paint AND for the initial load burst of network stats to
  // settle, so a transient init-tab stutter does not wrongly downgrade a device.
  setTimeout(() => {
    armed = true;
    lastTs = performance.now();
    requestAnimationFrame(sample);
  }, 2500);
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
      value: "Gigabyte B760 GAMING",
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
  // Animate the counters on the very first load only; on later refreshes
  // values are set directly so the count-up is never replayed from 0.
  if (refreshGitHubStats.firstRender === undefined) {
    refreshGitHubStats.firstRender = true;
  }

  const projectsEl = document.getElementById("stat-projects");
  const commitsEl = document.getElementById("stat-commits");
  const followersEl = document.getElementById("stat-followers");
  const lastUpdateEl = document.getElementById("stats-last-update");
  const activityStarsEl = document.getElementById("starred-list");
  const activityCommitsEl = document.getElementById("commits-list");

  // No stat module roots = not the homepage (e.g. 404). Skip the fetch.
  if (
    !projectsEl &&
    !commitsEl &&
    !followersEl &&
    !activityStarsEl &&
    !activityCommitsEl
  ) {
    return;
  }

  const stats = await getGitHubData();

  // Check for Privacy Mode
  if (stats.privacyMode) {
    renderFeedState(activityStarsEl, "fas fa-lock", "Privacy Mode Active");
    renderFeedState(activityCommitsEl, "fas fa-lock", "Privacy Mode Active");
    if (projectsEl) projectsEl.textContent = "\u2014";
    if (commitsEl) commitsEl.textContent = "\u2014";
    if (followersEl) followersEl.textContent = "\u2014";
    if (lastUpdateEl) lastUpdateEl.textContent = "Privacy Mode Active";
    return;
  }

  // Check for API Error
  if (stats.error) {
    renderFeedState(
      activityStarsEl,
      "fas fa-plug-circle-xmark",
      "Failed to load",
      "Check back later",
    );
    renderFeedState(
      activityCommitsEl,
      "fas fa-plug-circle-xmark",
      "Failed to load",
      "Check back later",
    );
    if (projectsEl) projectsEl.textContent = "\u2014";
    if (commitsEl) commitsEl.textContent = "\u2014";
    if (followersEl) followersEl.textContent = "\u2014";
    if (lastUpdateEl) lastUpdateEl.textContent = "Connection issues";
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

  // Animate only on first load; on refresh, update values directly
  // to avoid resetting the counter animation to 0 every time.
  if (refreshGitHubStats.firstRender) {
    if (projectsEl) animateCounter("stat-projects", projectsCount || 0, 1500);
    if (followersEl) {
      animateCounter("stat-followers", followersCount || 0, 1500);
    }
    if (commitsEl) animateCounter("stat-commits", commitsCount || 0, 1500);
    refreshGitHubStats.firstRender = false;
  } else {
    if (projectsEl) projectsEl.textContent = projectsCount ?? 0;
    if (followersEl) followersEl.textContent = followersCount ?? 0;
    if (commitsEl) commitsEl.textContent = commitsCount ?? 0;
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
    clearFeedState(activityStarsEl);
    activityStarsEl.innerHTML = "";
    activityStarsEl.appendChild(fragment);
  } else if (activityStarsEl) {
    renderFeedState(activityStarsEl, "fas fa-star", "No recent stars");
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
    clearFeedState(activityCommitsEl);
    activityCommitsEl.innerHTML = "";
    activityCommitsEl.appendChild(fragment);
  } else if (activityCommitsEl) {
    renderFeedState(
      activityCommitsEl,
      "fas fa-code-commit",
      "No recent commits",
    );
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

// Unified "no live data" state for the status panels (both privacy mode and
// an unreachable service). Clears the avatar slot and renders a centered
// design-system icon, and sets the status caption - so a panel never shows a
// broken avatar or a bare "Offline" label that breaks the layout.
function renderStatusFallback(avatarWrapperSel, iconClass, statusId, label) {
  const avatarWrapper = document.querySelector(avatarWrapperSel);
  if (avatarWrapper) {
    avatarWrapper.innerHTML = "";
    const icon = document.createElement("i");
    icon.className = iconClass;
    icon.style.fontSize = "2rem";
    icon.style.color = "var(--primary)";
    icon.style.position = "absolute";
    icon.style.top = "50%";
    icon.style.left = "50%";
    icon.style.transform = "translate(-50%, -50%)";
    avatarWrapper.style.position = "relative";
    avatarWrapper.appendChild(icon);
  }
  const status = document.getElementById(statusId);
  if (status) status.textContent = label;
}

// Render a full-tile message into a live-feed list (no scroll, centered on the card).
function renderFeedState(listEl, iconClass, title, subtext) {
  if (!listEl) return;
  listEl.classList.add("feed-state");
  listEl.innerHTML = `
                <div class="activity-empty-state">
                    <i class="${iconClass}"></i>
                    <p>${title}</p>
                    ${subtext ? `<small style="opacity: 0.7;">${subtext}</small>` : ""}
                </div>
            `;
}

// Restore a feed list to scrollable content (remove the full-tile message state).
function clearFeedState(listEl) {
  if (!listEl || !listEl.classList) return;
  listEl.classList.remove("feed-state");
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

  // Check for Privacy Mode - hide live data, show a lock state
  if (stats.privacyMode) {
    const gameInfo = document.getElementById("steam-game-info");
    const extraInfo = document.querySelector(".steam-extra-info");
    const steamUsernameEl = document.querySelector(".steam-username");
    if (gameInfo) gameInfo.style.display = "none";
    if (extraInfo) extraInfo.style.display = "none";
    if (steamUsernameEl) steamUsernameEl.textContent = "Hidden";
    renderStatusFallback(
      ".steam-avatar-wrapper",
      "fas fa-lock",
      "steam-status-text",
      "Privacy Mode",
    );
    return;
  }

  // Check for API Error - cannot reach the service
  if (stats.error) {
    const steamUsernameEl = document.querySelector(".steam-username");
    if (steamUsernameEl) steamUsernameEl.textContent = "Offline";
    renderStatusFallback(
      ".steam-avatar-wrapper",
      "fas fa-plug-circle-xmark",
      "steam-status-text",
      "Unavailable",
    );
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
  if (!discordPanel) return;

  try {
    const response = await fetch(API_ENDPOINTS.discord);
    if (response.ok) {
      const data = await response.json();
      console.log("Discord API response:", data);

      // Check for Privacy Mode - hide live data, show a lock state
      if (data.privacyMode) {
        if (discordUsernameEl) discordUsernameEl.textContent = "Hidden";
        if (discordActivityInfo) discordActivityInfo.style.display = "none";
        renderStatusFallback(
          ".discord-avatar-wrapper",
          "fas fa-lock",
          "discord-status-text",
          "Privacy Mode",
        );
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
    // Cannot reach the service - show the unified unavailable state
    const discordUsernameElCatch = document.querySelector(".discord-username");
    if (discordUsernameElCatch) discordUsernameElCatch.textContent = "Offline";
    renderStatusFallback(
      ".discord-avatar-wrapper",
      "fas fa-plug-circle-xmark",
      "discord-status-text",
      "Unavailable",
    );
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

  // Check for Privacy Mode - hide live data, show a lock state
  if (data.privacyMode) {
    const gameInfo = document.getElementById("roblox-game-info");
    const usernameEl = document.querySelector(".roblox-username");
    if (usernameEl) usernameEl.textContent = "Hidden";
    if (gameInfo) gameInfo.style.display = "none";
    renderStatusFallback(
      ".roblox-avatar-wrapper",
      "fas fa-lock",
      "roblox-status-text",
      "Privacy Mode",
    );
    robloxPanel.style.display = "flex";
    return;
  }

  // Check for API Error - cannot reach the service
  if (data.error) {
    const robloxUsernameEl = document.querySelector(".roblox-username");
    if (robloxUsernameEl) robloxUsernameEl.textContent = "Offline";
    renderStatusFallback(
      ".roblox-avatar-wrapper",
      "fas fa-plug-circle-xmark",
      "roblox-status-text",
      "Unavailable",
    );
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

  // Store the animate function to reuse it when resuming. The visualizer is
  // tier-aware: low tiers draw fewer bars or skip rendering entirely so a weak
  // phone still gets audio without burning GPU on the bars it cannot afford.
  window.visualizerAnimate = function () {
    const tier = deviceCapabilities.perfTier;
    if (!ctx) return;
    if (!audioPlaying || document.hidden || PERF[tier].visStep === 0) {
      // Always clear the canvas first: stopping (or a tab switch mid-paint)
      // must never leave the previous frame's bars frozen on screen.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(visualizerAnimationFrame);
      return;
    }
    visualizerAnimationFrame = requestAnimationFrame(window.visualizerAnimate);
    analyser.getByteFrequencyData(dataArray);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const step = PERF[tier].visStep;
    const bars = Math.ceil(bufferLength / step);
    const barWidth = (canvas.width / bars) * 0.9;
    let x = 0;

    for (let i = 0; i < bufferLength; i += step) {
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
      x += barWidth + step * 0.25;
    }
  };

  // Start animation if not already running
  window.visualizerAnimate();
}

let particleCanvas = null;
let particleCtx = null;
let particleW = 0;
let particleH = 0;
let particleList = [];

function initParticles() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  particleCanvas = canvas;
  particleCtx = canvas.getContext("2d");

  const resize = () => {
    particleW = particleCanvas.width = window.innerWidth;
    particleH = particleCanvas.height = window.innerHeight;
  };
  window.addEventListener("resize", resize);
  resize();

  window.particlesAnimate = function () {
    if (!particleCtx) return;
    if (document.hidden) {
      cancelAnimationFrame(particlesAnimationFrame);
      return;
    }
    particleCtx.clearRect(0, 0, particleW, particleH);
    particleList.forEach((p) => {
      Particle.update(p, particleW, particleH);
      Particle.draw(p, particleCtx);
    });
    particlesAnimationFrame = requestAnimationFrame(window.particlesAnimate);
  };

  rebuildParticles();
  // Start the loop unless the operative tier disables particles entirely.
  if (deviceCapabilities.perfTier > 0 && !document.hidden) {
    window.particlesAnimate();
  } else {
    console.log("Particles disabled at tier " + deviceCapabilities.perfTier);
  }
}

const Particle = {
  update(p, w, h) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = w;
    if (p.x > w) p.x = 0;
    if (p.y < 0) p.y = h;
    if (p.y > h) p.y = 0;
  },
  draw(p, ctx) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  },
};

function spawnParticle() {
  return {
    x: Math.random() * particleW,
    y: Math.random() * particleH,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    size: Math.random() * 3 + 2,
    color: `rgba(0, 255, 136, ${Math.random() * 0.3})`,
  };
}

function rebuildParticles() {
  particleList = [];
  const count = PERF[deviceCapabilities.perfTier].particles;
  for (let i = 0; i < count; i++) particleList.push(spawnParticle());
}

// Called by the watchdog / tier changes to bring runtime loops in line with
// the current tier and re-register adaptive refresh intervals.
function reconfigurePerfForTier() {
  if (particleCanvas) {
    rebuildParticles();
    if (deviceCapabilities.perfTier === 0) {
      if (particlesAnimationFrame)
        cancelAnimationFrame(particlesAnimationFrame);
    } else if (window.particlesAnimate && !document.hidden) {
      window.particlesAnimate();
    }
  }
  scheduleAdaptiveIntervals();
}

// Adaptive auto-refresh intervals. Clearing + re-registering lets the watchdog
// lengthen (or shorten) the poll cadence when the tier changes at runtime.
let periodicTimers = [];
function scheduleAdaptiveIntervals() {
  periodicTimers.forEach((t) => clearInterval(t));
  periodicTimers = [];
  const [statsInterval, steamInterval, spotifyInterval] =
    PERF[deviceCapabilities.perfTier].intervals;
  const timers = [];
  if (
    document.getElementById("stat-projects") ||
    document.getElementById("starred-list")
  )
    timers.push(setInterval(refreshGitHubStats, statsInterval));
  if (document.getElementById("steam-status-panel"))
    timers.push(setInterval(refreshSteamStatus, steamInterval));
  if (document.getElementById("discord-status-panel"))
    timers.push(setInterval(refreshDiscordStatus, 15000));
  if (document.getElementById("roblox-status-panel"))
    timers.push(setInterval(refreshRobloxStatus, steamInterval));
  if (document.getElementById("spotify-content"))
    timers.push(setInterval(updateSpotifyStatus, spotifyInterval));
  periodicTimers = periodicTimers.concat(timers);
}

function initAvatarErrorHandlers() {
  // Graceful image degradation: on any avatar load failure, hide the
  // broken <img> (no raw alt text) and show a centered user icon in the
  // (relatively positioned) avatar wrapper so layout stays intact.
  const fallbackClass = "fa-user avatar-fallback";
  document
    .querySelectorAll("#avatar, #steam-pfp, #discord-pfp, #roblox-pfp")
    .forEach((img) => {
      img.addEventListener("error", function onAvatarError() {
        this.removeEventListener("error", onAvatarError);
        this.style.display = "none";
        const wrapper = this.closest(
          ".avatar, .steam-avatar-wrapper, .discord-avatar-wrapper, .roblox-avatar-wrapper",
        );
        if (wrapper && !wrapper.querySelector(".avatar-fallback")) {
          const icon = document.createElement("i");
          icon.className = fallbackClass;
          wrapper.appendChild(icon);
        }
      });
    });
}

function initCopyButtons() {
  // Single coherent copy-to-clipboard system (used by 404 contact links).
  function wireCopy(selector, text) {
    document.querySelectorAll(selector).forEach((link) => {
      link.addEventListener("click", () => {
        if (!navigator.clipboard || !navigator.clipboard.writeText) return;
        navigator.clipboard.writeText(text).catch(() => {});
        const label = link.querySelector("span") || link;
        const orig = label.textContent;
        label.textContent = "Copied!";
        link.style.borderColor = "var(--primary)";
        setTimeout(() => {
          label.textContent = orig;
          link.style.borderColor = "";
        }, 1500);
      });
    });
  }
  wireCopy('a[href*="discord.com"]', "alciaforlife");
  wireCopy('a[href^="mailto:"]', "contact@piotrunius.dev");
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
  if (!text) return;
  // On the lowest tier, show the full bio instantly instead of animating it.
  if (!PERF[deviceCapabilities.perfTier].typing) {
    bioEl.textContent = text;
    return;
  }
  // Prevent CLS by preserving the height before clearing text
  const currentHeight = bioEl.getBoundingClientRect().height;
  if (currentHeight > 0) {
    bioEl.style.minHeight = `${currentHeight}px`;
  }
  bioEl.textContent = "";
  bioEl.classList.add("typing-cursor");
  let i = 0;
  function type() {
    if (i < text.length) {
      bioEl.textContent += text.charAt(i);
      i++;
      setTimeout(type, 30 + Math.random() * 50);
    } else {
      setTimeout(() => {
        bioEl.classList.remove("typing-cursor");
      }, 1000);
    }
  }
  type();
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
  if (!container) return;

  try {
    const response = await fetch(API_ENDPOINTS.spotify);
    const data = await response.json();
    console.log("Spotify API response:", data);

    // Cannot reach the service - show the unified unavailable state
    if (!response.ok || data.error) {
      renderSpotifyUnavailable(container);
      lastSpotifyData = null;
      if (spotifyPredictorInterval) {
        clearInterval(spotifyPredictorInterval);
        spotifyPredictorInterval = null;
      }
      return;
    }

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
    renderSpotifyUnavailable(container);
    lastSpotifyData = null;
    if (spotifyPredictorInterval) {
      clearInterval(spotifyPredictorInterval);
      spotifyPredictorInterval = null;
    }
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

function renderSpotifyUnavailable(container) {
  if (container.classList.contains("unavailable")) return;
  container.innerHTML = `
        <div class="spotify-placeholder">
            <i class="fas fa-plug-circle-xmark"></i>
            <span>Connection issues</span>
        </div>
    `;
  container.className = "spotify-content unavailable";
  delete container.dataset.trackId;
}

// --- TIME & TIMEZONE SECTION ---
const MY_TIMEZONE = "Europe/Warsaw"; // Your timezone

// --- INIT ---
document.addEventListener("DOMContentLoaded", async () => {
  // Initialize performance monitoring
  initPerformanceMonitoring();

  // Initialize scroll reveal immediately for instant smooth entrance
  initScrollReveal();

  // Detect device capabilities first, apply the base tier, then arm the
  // FPS watchdog so the tier can adapt to real device capability at runtime.
  detectDeviceCapabilities();
  applyPerfTier(deviceCapabilities.baseTier, true);
  initPerfWatchdog();

  await loadConfig();
  await loadProjectsConfig();
  initProfile();
  initAvatarErrorHandlers();
  initCopyButtons();
  initSocials();
  initMusicMeta();
  initSetup();
  refreshGitHubStats();
  revealAllStatuses();
  updateSpotifyStatus();
  initControls();

  // Initialize particles only after capability detection
  initParticles();

  initTypingEffect();
  initVisibilityOptimization();
  updateCopyrightYear();

  // Auto-refresh stats with adaptive intervals (perf tier aware)
  scheduleAdaptiveIntervals();

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

    // A network/API failure is NOT an empty project list; signal that the
    // caller should render the connection-error state instead.
    if (data.error) {
      return null;
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

// Renders the 4-card skeleton grid (matches index.html) so privacy/offline
// states keep the exact same container height as the loaded projects grid.
function showProjectsMessage(container, inner) {
  // Keep the exact container height the 4-card skeleton established, then
  // show ONLY the message (no skeleton loaders behind it) so the page
  // does not jump when the skeleton disappears.
  const h = container.offsetHeight || 0;
  container.innerHTML = `<div class="grid-overlay"><div class="activity-empty-state">${inner}</div></div>`;
  if (h > 0) container.style.height = h + "px";
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
      showProjectsMessage(
        container,
        `<i class="fas fa-lock"></i>
         <p>Privacy Mode Active</p>`,
      );
      return;
    }

    // Now safely check if it's an array with repos
    if (!Array.isArray(allRepos) || allRepos.length === 0) {
      showProjectsMessage(
        container,
        `<i class="fas fa-code"></i>
         <p>No projects yet</p>`,
      );
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

    container.style.height = "";
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
    showProjectsMessage(
      container,
      `<i class="fas fa-plug-circle-xmark"></i>
       <p>Failed to load</p>
       <small style="opacity: 0.7;">Check back later</small>`,
    );
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
