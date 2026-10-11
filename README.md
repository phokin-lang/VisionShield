# VisionShield — Smart CCTV for Safer Tomorrow

A full-stack clone of the safety-monitoring dashboard: a dark, "safety-tech" themed
live camera wall with AI detection overlays, summary stats, and a violations feed —
backed by its own REST API.

```
visionshield/
├── backend/     Express REST API (cameras, alerts, stats)
└── frontend/    React + Vite + Tailwind dashboard UI
```

## Run the backend

```bash
cd backend
npm install
npm start          # http://localhost:4000
```

Endpoints:
| Method | Path                          | Purpose                                |
|--------|-------------------------------|-----------------------------------------|
| GET    | `/api/health`                 | Health check                            |
| GET    | `/api/cameras`                | List all camera feeds + detections      |
| GET    | `/api/cameras/:id`            | Single camera detail                    |
| POST   | `/api/cameras/:id/detections` | Push a new AI detection to a camera     |
| GET    | `/api/alerts?severity=`       | List alerts (all/critical/high/medium)  |
| PATCH  | `/api/alerts/:id/acknowledge` | Acknowledge a violation                 |
| GET    | `/api/stats`                  | Dashboard summary numbers               |
| GET    | `/api/settings`               | Current detection toggle state          |
| PUT    | `/api/settings`               | Save detection toggle state             |
| POST   | `/api/detect`                 | Upload a photo, run the trained PPE model on it |

Data currently lives in `backend/data/mockData.js` as an in-memory store —
swap that one module for a real database layer (Postgres, Mongo, etc.) and
none of the route files need to change.

## PPE detection (native Node, ONNX)

`backend/services/detector.js` runs two YOLOv8-nano ONNX models with `onnxruntime-node`:
the friend-trained PPE model (`Hard_hat`, `Vest`) and stock yolov8n for `Person`.
A person without an overlapping hat/vest is a violation. On boot the 8 camera frames in
`backend/assets/cameras` are scanned, which produces the camera boxes and alerts.
Peak RAM measured ~220 MB (12 MP upload + concurrent requests), so it fits Render's 512 MB.
`POST /api/detect` (multipart `image`, optional `cameraId`) analyses an uploaded photo.

## Features added in this version

- **Analyze a video** (Live cameras page): the browser decodes the video, samples up to 90 frames and sends
  each frame to `POST /api/detect`; boxes follow the video while it plays and a timeline shows when
  violations happen. The video file itself is never uploaded, so the server needs no ffmpeg and its RAM stays flat.
- **Light / dark theme** (Settings → Appearance), remembered per device.
- **Blur worker faces**: a real face detector (SCRFD-500M, 2.5 MB ONNX) finds faces; people whose face is too small/turned away fall back to an estimated head box. Drawn as a blur over camera feeds and the video player (the original media is not modified).
- **LINE notifications**: uses the LINE Messaging API (LINE Notify was shut down in 2025). Set
  `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_TO` on the server; Settings has a "Send test message" button.
- Recent violations: ticking the checkbox acknowledges the alert and removes it from the panel (it stays in Alert history).

## Deploy backend on Render

Use `render.yaml` (Root Directory `backend`, start `node --max-old-space-size=300 server.js`)
and set `CORS_ORIGIN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. `onnxruntime-node` is pinned to 1.20.1
on purpose (newer versions download CUDA binaries at install). Frontend: set `VITE_API_URL`
to `https://<service>.onrender.com/api`. Check `/api/health` for model + memory status.
Free plan sleeps when idle (first request ~50 s) and loses users on restart, hence `ADMIN_*`.

## Run the frontend

```bash
cd frontend
npm install
npm run dev         # http://localhost:5173
```

Vite proxies `/api/*` requests to `http://localhost:4000` (see `vite.config.js`),
so run the backend first, then the frontend. The dashboard polls the API every
15 seconds and lets you acknowledge violations from the side panel, which
calls the backend and updates the badge counts live.

## Theme

Dark navy base (`#05080d`–`#182233`) with a cyan-teal accent (`#3ee6c4`) for
"live"/safe states and amber/red for warnings and critical detections —
matching the reference design's safety/surveillance aesthetic. Bounding boxes
on each camera tile are driven by the `detections[].box` data from the API,
so real detection coordinates from a model can be dropped in directly.