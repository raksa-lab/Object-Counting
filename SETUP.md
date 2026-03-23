# Object Detector - Setup Instructions

This is an AI-powered object detection web application using YOLOv8 and a Next.js frontend.

## Architecture

- **Frontend**: Next.js with React (TypeScript)
- **Backend**: Flask API with YOLOv8 for object detection
- **Features**: Image upload, webcam real-time detection, confidence threshold adjustment

## Setup Steps

### 1. Install Frontend Dependencies

```bash
pnpm install
# or npm install / yarn install
```

### 2. Install Python Dependencies

Create a Python environment and install required packages:

```bash
# Create virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install required packages
pip install flask flask-cors opencv-python ultralytics numpy
```

### 3. Run the Backend API

Start the Flask backend server (in a separate terminal):

```bash
python scripts/api.py
```

The API will run on `http://localhost:5000`

### 4. Run the Frontend

In another terminal:

```bash
pnpm dev
# or npm run dev / yarn dev
```

The app will be available at `http://localhost:3000`

## Usage

### Upload Detection
1. Go to the "Upload" tab
2. Click or drag an image to upload
3. Adjust confidence threshold if needed
4. Click "Detect Objects"
5. View results and download the annotated image

### Webcam Detection
1. Go to the "Webcam" tab
2. Click "Start Camera"
3. Adjust confidence threshold if needed
4. Click "Capture & Detect" to analyze the current frame
5. View results

## Confidence Threshold

- Lower threshold (0.1-0.3): Detects more objects, including less certain predictions
- Medium threshold (0.5-0.7): Balanced detection (recommended)
- Higher threshold (0.8-1.0): Only highly confident detections

## Troubleshooting

### Backend not connecting
- Ensure Flask is running on port 5000
- Check CORS headers are properly configured
- Verify `http://localhost:5000` is accessible

### Camera not working
- Allow browser permission to access camera when prompted
- Try a different browser if one doesn't work
- Check if another application is using the camera

### Slow detection
- Lower image resolution
- Increase confidence threshold
- Consider using a more powerful device for the backend

### Memory issues
- YOLOv8n (nano model) is memory efficient
- For slower systems, ensure adequate RAM available
- Close other applications to free up resources

## Model Information

The app uses `yolov8n.pt` (YOLOv8 Nano):
- Lightweight and fast
- Good accuracy for general object detection
- ~80 object classes (COCO dataset)

To use a different model, edit `scripts/api.py` and change:
```python
model = YOLO("yolov8n.pt")  # Change to yolov8s.pt, yolov8m.pt, etc.
```

Available models: yolov8n, yolov8s, yolov8m, yolov8l, yolov8x

## Performance Notes

- First detection takes longer (model loading)
- Subsequent detections are faster
- Webcam detection processes each frame independently
- Larger models = better accuracy but slower inference

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Webcam may require HTTPS for production
- Mobile: Camera access varies by device
