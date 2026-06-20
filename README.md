# Piotrunius Portfolio

A beautiful, modern portfolio website showcasing real-time presence across multiple platforms. Features live status panels from Spotify, Steam, GitHub, Discord, and Roblox, combined with a glassmorphism design and interactive audio player.

> **Authorship Note:** This project was created by a human with approximately 20–30% AI assistance for ideation, wording, and refinements.

---

## ✨ Key Features

- 🎨 **Glassmorphism UI** - Modern frosted-glass aesthetic with smooth animations
- 👻 **Synchronized Ghost Loaders** - Elegant skeleton loading screens that reveal all statuses simultaneously
- 🌙 **Theme Toggle** - Switch between light and dark modes
- 🎵 **Local Audio Player** - Built-in music player with visualizer
- 📊 **Live Status Panels** - Real-time data from:
  - 🎵 Spotify (currently playing song)
  - 🐙 GitHub (profile stats & repositories)
  - 🎮 Steam (player status & game)
  - 💬 Discord (status & activities via Lanyard)
  - 🎮 Roblox (presence status)
- 📱 **PWA Support** - Install as app + offline caching
- 📊 **Responsive Design** - Works on desktop, tablet, mobile
- 🔐 **Privacy Mode** - Global kill-switch for all data with a native browser prompt authentication
- 🛡️ **Robust Fallbacks** - Graceful error handling UI with default Offline states when APIs are unreachable

---

## 🛠 Tech Stack

| Technology | Purpose |
|-----------|---------|
| **HTML5** | Semantic markup |
| **CSS3** | Modern styling & animations |
| **JavaScript (ES6+)** | Interactivity & API calls |
| **Cloudflare Workers** | Serverless API layer |
| **KV Storage** | Token caching & settings |
| **Font Awesome 6.5.1** | Icon library |
| **Umami Analytics** | Privacy-friendly analytics |

---

## 📂 Project Structure

```
.
├── 📄 index.html           # Main HTML
├── 🎨 styles.css           # Global styles
├── ⚙️  app.js              # Main JavaScript
├── 🔧 sw.js                # Service Worker (PWA)
├── 📋 manifest.json        # PWA manifest
├── 📚 projects.json        # Project data
├── 🎼 assets/
│   ├── pfp.png            # Profile picture
│   ├── audio.mp3          # Background music
│   └── nobara-icon.png    # App icon
└── 🔌 api/
    ├── spotify.js         # Spotify Worker
    ├── github.js          # GitHub Worker
    ├── steam.js           # Steam Worker
    ├── discord.js         # Discord Worker
    ├── roblox.js          # Roblox Worker
    └── admin.js           # Admin Worker
```

---

## 🚀 Getting Started

### Local Development

#### Option 1: Direct File
Simply open `index.html` in your browser.

#### Option 2: Local Server
```bash
# Python 3
python -m http.server 8000

# Or Node.js
npx http-server
```

Then visit: **http://localhost:8000**

### API Configuration

The live status panels require Cloudflare Workers to fetch real-time data.

#### Quick Setup

1. **Create Cloudflare Workers Project**
   - Visit [dash.cloudflare.com](https://dash.cloudflare.com/)
   - Create a new Workers project

2. **Create KV Namespace**
   ```bash
   wrangler kv:namespace create "STATE"
   ```

3. **Deploy Workers**
   - Copy each `.js` file from `api/` folder
   - Deploy to Cloudflare (or use Wrangler CLI)

4. **Add Secrets to Dashboard**
   ```
   SPOTIFY_CLIENT_ID = "..."
   SPOTIFY_CLIENT_SECRET = "..."
   SPOTIFY_REFRESH_TOKEN = "..."
   GITHUB_TOKEN = "..."
   STEAM_API_KEY = "..."
   STEAM_ID = "..."
   DISCORD_ID = "..."
   ROBLOX_USER_ID = "..."
   ADMIN_PASSWORD = "..."
   ```

5. **Update API URLs**
   - Edit `app.js` to point to your deployed workers
   - Example: `https://workers.example.com/spotify`

---

## 🔌 API Workers

Each worker requires specific environment variables and API credentials.

### Available Workers

| Worker | Data | Secrets |
|--------|------|---------|
| **spotify.js** | 🎵 Playing song | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN` |
| **github.js** | 🐙 Profile & repos | `GITHUB_TOKEN`, `GITHUB_USERNAME` (optional) |
| **steam.js** | 🎮 Player status | `STEAM_API_KEY`, `STEAM_ID` |
| **discord.js** | 💬 Status & activities | `DISCORD_ID` |
| **roblox.js** | 🎮 Presence status | `ROBLOX_USER_ID` |
| **admin.js** | 🔐 Privacy Mode toggle | `ADMIN_PASSWORD` |

### Privacy Mode

All workers respect a global **Privacy Mode** flag:

```
KV Namespace: STATE
Key: PRIVACY_MODE
Value: "true" | "false"
```

When enabled, all APIs return:
```json
{
  "privacyMode": true,
  "message": "Privacy Mode Active"
}
```

---

## 🎨 Customization

### Change Colors & Theme

Edit `styles.css` to customize:
- Primary colors: `--color-primary`, `--color-secondary`
- Backgrounds: `--bg-light`, `--bg-dark`
- Fonts: `:root` CSS variables

### Update Profile Info

Edit `index.html`:
- Name, bio, links in the hero section
- Social media URLs
- Contact information

### Modify Project Data

Edit `projects.json` to add/remove projects:
```json
{
  "projects": [
    {
      "name": "Project Name",
      "description": "Brief description",
      "technologies": ["Tech1", "Tech2"],
      "link": "https://..."
    }
  ]
}
```

---

## 📱 Features in Detail

### 🎵 Audio Player

- Local music playback with visualizer
- Play/pause controls
- Volume adjustment
- Progress bar

### 📊 Status Panels

Real-time data updates (configurable interval):
- **Spotify:** Album art, song title, artist, progress
- **GitHub:** Profile picture, repos, followers, stats, and animated skeletons for recent activity
- **Steam:** Avatar, username, current game, status
- **Discord:** Status indicator, current activity, avatar
- **Roblox:** Presence status, avatar, game location

*Note: Status panels use a coordinated loading mechanism, ensuring Discord, Steam, and Roblox data fetches are fully settled before gracefully revealing the content together from a skeleton state.*

### 🔐 Privacy Controls

Disable all data fetching with one setting:
- Toggle via the hidden lock icon with a native browser password prompt (`Piotrunius123`)
- Or set `PRIVACY_MODE = "true"` in KV manually
- All endpoints return a privacy notice, displaying lock icons and hiding sensitive data globally
- No data leakage

### 🌙 Dark/Light Mode

Automatic detection + manual toggle:
- Respects system preference
- Toggle button in header
- Persists to localStorage

---

## 📊 Analytics

Uses **Umami Analytics** for privacy-friendly statistics:
- No cookies or identifiers
- Respects user privacy
- Basic traffic metrics only

---

## 🌐 Live Site

**https://piotrunius.dev/**

---

## 📖 Documentation

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)

---

## 🔗 Contact & Links

| Platform | Link |
|----------|------|
| **Discord** | [@alciaforlife](https://discord.com/users/1166309729371439104) |
| **GitHub** | [@Piotrunius](https://github.com/Piotrunius) |
| **Email** | [piotrunius.v2@gmail.com](mailto:piotrunius.v2@gmail.com) |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

Feel free to use, modify, and distribute this code as long as you include the original license.

---

## 🙏 Acknowledgments

- [Font Awesome](https://fontawesome.com/) - Icon library
- [Cloudflare](https://www.cloudflare.com/) - Workers & KV storage
- [Lanyard](https://lanyard.rest/) - Discord status API
- The open-source community

---

**Made with ❤️ by Piotrunius**
