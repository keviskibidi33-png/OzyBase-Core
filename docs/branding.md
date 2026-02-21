# OzyBase Design System & Branding Guidelines

<div align="center">
  <img src="FOzybaselogo.jpg" alt="OzyBase Logo" width="120" />
  <br/>
  <img src="docs/banner.jpg" alt="OzyBase Banner" width="100%" />
</div>

*Inspired by Supabase's high-fidelity "Developer Experience" aesthetic.*

## 1. Core Philosophy
OzyBase follows a **"Function-First, Dark-Default"** philosophy. The interface is designed for power users (developers, DBAs, engineers) who spend hours in the dashboard.
- **Immersion**: Dark mode is mandatory, not optional. It reduces eye strain and highlights syntax.
- **Density**: High information density with legible typography.
- **Contrast**: Use of neon accents (Neon Green/Yellow) against deep charcoal backgrounds to indicate status and action.

## 2. Color Palette

### 🌑 Surface & Backgrounds
Deep, neutral grays are used to create depth without using pure black (except for terminals).
- **Ultra Dark**: `#0c0c0c` (Main App Background, Code Editors)
- **Surface**: `#111111` (Sidebars, Cards)
- **Surface Highlight**: `#171717` (Hover states, Active Cards)
- **Borders**: `#2e2e2e` (Subtle dividers)

### ⚡ Accents (The "Ozy" Glow)
Used sparingly for primary actions, active states, and success indicators.
- **Primary (Ozy Yellow/Green)**: `text-primary` (Tailwind class) / `#E6E600` (Approx) - Used for buttons, active sidebar borders, brand logo.
- **Success**: `#22c55e` (Green-500) - Connected statuses, safe actions.
- **Error**: `#ef4444` (Red-500) - Disconnected, dangerous actions.
- **Warning**: `#f59e0b` (Amber-500) - Performance hints, lint warnings.

### 🖊️ Typography
- **Primary Font**: `Inter` or System Sans-Serif. Clean, readable at small sizes.
- **Monospace**: `JetBrains Mono` or `Fira Code`. Required for SQL editors, logs, and IDs.
- **Labels**: Small cap headers (`text-[10px] uppercase font-black tracking-widest`) are a signature trait.

## 3. Layout Architecture

### A. The "Command Deck" Layout
The layouts consist of three vertical panes (from left to right):
1.  **Primary Mini-Sidebar (`w-14` -> `w-64`)**:
    *   **Behavior**: Collapsed by default, expands on hover or via "Pin" button.
    *   **Content**: Global Module Switching (Home, Database, Auth, Storage, Edge).
    *   **Icons**: Lucide React icons, stroke width 2/2.5. Active state gets a neon glow and background block.

2.  **Explorer Sidebar (`w-60` or `0`)**:
    *   **Behavior**: Context-aware. content changes based on the active Primary Module.
    *   **Context**:
        *   *Database*: List of Tables.
        *   *Auth*: Users, Policies, Providers.
        *   *Overview*: Hidden (Full-width dashboard).
    *   **Styling**: Fixed width, border-right, scrolling list of sub-resources.

3.  **Main Viewport**:
    *   **Behavior**: Fluid width (`flex-1`).
    *   **Header**: Breadcrumbs (`Project / Active Module`), Environment Badge (`Production`), Status Indicators.
    *   **Content**: The actual workspace (Table Grid, SQL Editor, Metrics).

## 4. UI Component Rules

### Buttons
- **Primary**: Solid Neon Background, Black Text, Uppercase, Tracking Widest.
- **Ghost/Tertiary**: Transparent background, text-zinc-500, hover:text-white.

### Cards & Panels
- **Border**: 1px solid `#2e2e2e`.
- **Corner Radius**: `rounded-xl` or `rounded-2xl`.
- **Shadows**: Deep, soft shadows for elevation `shadow-2xl`.

### Inputs
- **Background**: `#0c0c0c` (Darker than surface).
- **Border**: `#2e2e2e`, focus: `#primary/50`.

## 5. Module Structure (Frontend <-> Backend)
Each frontend module maps to specific backend capabilities.

| Module | Sub-Modules (Explorer) | Backend Validation Required |
| :--- | :--- | :--- |
| **Database** | Tables, Roles, Extensions, Replication | GET `/api/collections`, POST `/api/query` |
| **Auth** | Users, Providers, Policies, Templates | (Planned) Integrates with Go GoTrue implementation |
| **Storage** | Buckets, Policies, Usage | (Planned) S3 Compatible Interface |
| **Edge** | Functions, Deployments, Secrets | (Planned) Deno/Go Runtime Runner |
| **Realtime** | Inspector, Channels, Presence | (Planned) WebSocket Debugger |
| **Settings** | General, Infrastructure, Billing | GET `/api/config` |

## 6. CSS Global Overrides
We use custom scrollbars to match the dark theme.
```css
.custom-scrollbar::-webkit-scrollbar { width: 4px; }
.custom-scrollbar-thumb { background: #2e2e2e; rounded: 10px; }
```
## 7. Feedback & Notifications
Following the Supabase pattern, OzyBase uses a non-intrusive but highly visible notification system.

### A. Placement
- **Standard Notifications (Toasts)**: Top-right corner of the viewport (`fixed top-6 right-6`).
- **Critical Banners**: Inline within the main content header, spanning the full width.

### B. Color States
Notifications must use high-contrast status colors to communicate urgency instantly:
- **Success (Green)**: `#22c55e` - Used for successful database operations, fixes applied, and connections.
- **Warning (Amber)**: `#f59e0b` - Used for non-critical performance issues or data linting.
- **Error (Red)**: `#ef4444` - Used for failed operations, security breaches, or system crashes.

### C. Visual Anatomy
- **Backdrop**: Uses `backdrop-blur-md` and a semi-transparent background to maintain context while appearing elevated.
- **Progress Bar**: A subtle underline progress bar indicates the time remaining before auto-dismissal.
- **Micro-Animations**: Success notifications should use a subtle bounce on the check icon to reward the user.

## 8. Motion Consistency
Small overlays (notification center, user dropdown, compact menus) must follow one shared pattern:

- **Entry**: 180-220ms, `opacity + translateY(-6px to 0) + scale(0.95 to 1)`.
- **Exit**: 140-180ms, reverse transform, never instant-hide.
- **Origin**: Top-right (`origin-top-right`) for header actions.
- **Interaction Safety**: Hidden overlays must use `pointer-events-none` while closed.
- **Priority**: Motion should guide focus, not distract; avoid bounce or long chained easing on critical actions.
