'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Slider } from './ui/slider'
import { Badge } from './ui/badge'
import { Spinner } from './ui/spinner'
import { Upload, Camera, Play, Square, RotateCw, Download, Zap } from 'lucide-react'

interface DetectionResult {
  counts: Record<string, number>
  total: number
  image?: string
  config_used?: Record<string, any>
}

const BACKEND_URL = (
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : '')
).replace(/\/$/, '')
const DEFAULT_CONFIG = {
  confidence: 0.55,
  iou_threshold: 0.45,
  preprocess: true,
  use_nms: true,
  min_detection_area: 100,
}
const MAX_UPLOAD_DIMENSION = 1280
const UPLOAD_JPEG_QUALITY = 0.82

export function ObjectDetector() {
  const [activeTab, setActiveTab] = useState('upload')
  const [loading, setLoading] = useState(false)
  const [modelLoading, setModelLoading] = useState(false)
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [confidence, setConfidence] = useState(0.55)
  const [error, setError] = useState('')
  const [useBackend, setUseBackend] = useState(true)
  const [optimalConfig, setOptimalConfig] = useState<any>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const resultCanvasRef = useRef<HTMLCanvasElement>(null)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const [webcamActive, setWebcamActive] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const webcamDetectionIntervalRef = useRef<number | null>(null)
  const webcamDetectionBusyRef = useRef(false)
  const previousMotionFrameRef = useRef<Uint8ClampedArray | null>(null)
  const lastInferenceAtRef = useRef<number>(0)

  const MOTION_SAMPLE_WIDTH = 96
  const MOTION_SAMPLE_HEIGHT = 54
  const MOTION_PIXEL_DELTA = 22
  const MOTION_RATIO_THRESHOLD = 0.018
  const INFERENCE_COOLDOWN_MS = 700
  const INFERENCE_KEEPALIVE_MS = 3500

  const drawResultImage = useCallback((imageData: string) => {
    if (!resultCanvasRef.current || !imageData) return

    const img = new Image()
    img.onload = () => {
      const canvas = resultCanvasRef.current
      if (!canvas) return
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
      }
    }
    img.onerror = () => {
      setError('Unable to render detection image.')
    }
    img.src = imageData
  }, [])

  // Fetch optimal config from backend on mount
  useEffect(() => {
    const fetchConfig = async () => {
      if (!BACKEND_URL) {
        setUseBackend(false)
        setOptimalConfig(DEFAULT_CONFIG)
        return
      }

      // Keep backend enabled when URL exists; config fetch can fail during cold starts.
      setUseBackend(true)

      try {
        const response = await fetch(`${BACKEND_URL}/api/config`)
        const data = await response.json()
        if (data.config) {
          setUseBackend(true)
          setOptimalConfig(data.config)
          setConfidence(data.config.confidence || 0.55)
          console.log('✓ Optimal config loaded:', data.config)
        }
      } catch (err) {
        setOptimalConfig(DEFAULT_CONFIG)
        console.log('Backend config endpoint unavailable, using default config')
      }
    }
    fetchConfig()
  }, [])

  // Cleanup webcam on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop())
      }
    }
  }, [cameraStream])

  // Attach stream after the video element is mounted/rendered
  useEffect(() => {
    if (!videoRef.current || !cameraStream) return

    videoRef.current.srcObject = cameraStream
    videoRef.current.onloadedmetadata = () => {
      void videoRef.current?.play().catch(() => {
        setError('Camera started, but autoplay was blocked.')
      })
    }
  }, [cameraStream])

  // Render backend image after result card/canvas is mounted.
  useEffect(() => {
    if (result?.image) {
      drawResultImage(result.image)
    }
  }, [result?.image, drawResultImage])

  const detectWithBackend = useCallback(async (imageData: string) => {
    if (!BACKEND_URL) {
      setUseBackend(false)
      setError('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in Vercel project settings.')
      return
    }

    try {
      const payload = {
        image: imageData,
        confidence: confidence,
        iou_threshold: optimalConfig?.iou_threshold || DEFAULT_CONFIG.iou_threshold,
        preprocess: optimalConfig?.preprocess ?? DEFAULT_CONFIG.preprocess,
        use_nms: optimalConfig?.use_nms ?? DEFAULT_CONFIG.use_nms,
        min_area: optimalConfig?.min_detection_area || DEFAULT_CONFIG.min_detection_area
      }

      const response = await fetch(`${BACKEND_URL}/api/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        throw new Error('Backend detection failed')
      }

      const data = await response.json()

      if (data.success && data.image) {
        setResult({
          counts: data.counts,
          total: data.total,
          image: data.image,
          config_used: data.config_used
        })
      } else {
        setError(data.error || 'Detection failed')
      }
    } catch (err) {
      console.error('Backend error:', err)
      setError(`Backend request failed. If your backend is on Render free tier, wait a few seconds and try again: ${BACKEND_URL}`)
    }
  }, [confidence, optimalConfig])

  const hasMotion = useCallback((video: HTMLVideoElement) => {
    const canvas = document.createElement('canvas')
    canvas.width = MOTION_SAMPLE_WIDTH
    canvas.height = MOTION_SAMPLE_HEIGHT
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return true

    ctx.drawImage(video, 0, 0, MOTION_SAMPLE_WIDTH, MOTION_SAMPLE_HEIGHT)
    const current = ctx.getImageData(0, 0, MOTION_SAMPLE_WIDTH, MOTION_SAMPLE_HEIGHT).data

    if (!previousMotionFrameRef.current) {
      previousMotionFrameRef.current = new Uint8ClampedArray(current)
      return true
    }

    const prev = previousMotionFrameRef.current
    let changed = 0
    const totalPixels = MOTION_SAMPLE_WIDTH * MOTION_SAMPLE_HEIGHT

    for (let i = 0; i < current.length; i += 4) {
      const grayNow = (current[i] + current[i + 1] + current[i + 2]) / 3
      const grayPrev = (prev[i] + prev[i + 1] + prev[i + 2]) / 3
      if (Math.abs(grayNow - grayPrev) > MOTION_PIXEL_DELTA) {
        changed += 1
      }
    }

    previousMotionFrameRef.current = new Uint8ClampedArray(current)
    const motionRatio = changed / totalPixels
    return motionRatio > MOTION_RATIO_THRESHOLD
  }, [
    MOTION_SAMPLE_WIDTH,
    MOTION_SAMPLE_HEIGHT,
    MOTION_PIXEL_DELTA,
    MOTION_RATIO_THRESHOLD,
  ])

  const detectWebcamFrame = useCallback(async () => {
    if (!videoRef.current || !webcamActive || !useBackend) return
    if (webcamDetectionBusyRef.current) return
    if (videoRef.current.readyState < 2) return

    const now = Date.now()
    const moved = hasMotion(videoRef.current)
    const inCooldown = now - lastInferenceAtRef.current < INFERENCE_COOLDOWN_MS
    const keepaliveDue = now - lastInferenceAtRef.current > INFERENCE_KEEPALIVE_MS

    // Run inference only on action/motion, with periodic keepalive refresh.
    if ((inCooldown || !moved) && !keepaliveDue) {
      return
    }

    webcamDetectionBusyRef.current = true
    try {
      const canvas = document.createElement('canvas')
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.drawImage(videoRef.current, 0, 0)
      const imageData = canvas.toDataURL('image/jpeg', 0.9)
      await detectWithBackend(imageData)
      lastInferenceAtRef.current = now
    } catch {
      // Keep loop running even if one frame fails.
    } finally {
      webcamDetectionBusyRef.current = false
    }
  }, [
    webcamActive,
    useBackend,
    detectWithBackend,
    hasMotion,
    INFERENCE_COOLDOWN_MS,
    INFERENCE_KEEPALIVE_MS,
  ])

  // Auto-detect continuously while webcam is active.
  useEffect(() => {
    if (!webcamActive || !useBackend) return

    // Trigger one detection immediately on camera start.
    void detectWebcamFrame()

    if (webcamDetectionIntervalRef.current) {
      window.clearInterval(webcamDetectionIntervalRef.current)
    }

    webcamDetectionIntervalRef.current = window.setInterval(() => {
      void detectWebcamFrame()
    }, 900)

    return () => {
      if (webcamDetectionIntervalRef.current) {
        window.clearInterval(webcamDetectionIntervalRef.current)
        webcamDetectionIntervalRef.current = null
      }
      webcamDetectionBusyRef.current = false
    }
  }, [webcamActive, useBackend, detectWebcamFrame])

  const optimizeImageForBackend = useCallback((imageData: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const longestSide = Math.max(img.width, img.height)
        if (longestSide <= MAX_UPLOAD_DIMENSION) {
          resolve(imageData)
          return
        }

        const scale = MAX_UPLOAD_DIMENSION / longestSide
        const targetWidth = Math.round(img.width * scale)
        const targetHeight = Math.round(img.height * scale)

        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas unavailable'))
          return
        }

        ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
        resolve(canvas.toDataURL('image/jpeg', UPLOAD_JPEG_QUALITY))
      }
      img.onerror = () => reject(new Error('Unable to process uploaded image'))
      img.src = imageData
    })
  }, [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (event) => {
      const imageData = event.target?.result as string
      try {
        const optimizedImage = await optimizeImageForBackend(imageData)
        setUploadedImage(optimizedImage)
      } catch {
        setUploadedImage(imageData)
      }
      setResult(null)
    }
    reader.readAsDataURL(file)
  }

  const handleDetect = async () => {
    if (!uploadedImage) {
      setError('Please upload an image first')
      return
    }

    setLoading(true)
    setError('')

    if (useBackend) {
      await detectWithBackend(uploadedImage)
    } else {
      setError('Please enable backend detection (requires Flask server running)')
    }

    setLoading(false)
  }

  const handleWebcamCapture = async () => {
    if (!videoRef.current) return

    setLoading(true)
    setError('')

    try {
      const canvas = document.createElement('canvas')
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0)
        const imageData = canvas.toDataURL('image/jpeg')
        await detectWithBackend(imageData)
      }
    } catch (err) {
      setError('Failed to capture frame')
    } finally {
      setLoading(false)
    }
  }

  const startWebcam = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera is not supported in this browser.')
        return
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true })
      }

      setCameraStream(stream)
      setWebcamActive(true)
      setError('')
      setResult(null)
    } catch (err) {
      setError('Unable to access camera. Please allow camera permission.')
    }
  }

  const stopWebcam = () => {
    if (webcamDetectionIntervalRef.current) {
      window.clearInterval(webcamDetectionIntervalRef.current)
      webcamDetectionIntervalRef.current = null
    }

    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop())
      setCameraStream(null)
    }
    previousMotionFrameRef.current = null
    lastInferenceAtRef.current = 0
    setWebcamActive(false)
  }

  const resetUpload = () => {
    setUploadedImage(null)
    setResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const downloadResult = () => {
    if (!resultCanvasRef.current) return

    const link = document.createElement('a')
    link.href = resultCanvasRef.current.toDataURL('image/jpeg', 0.9)
    link.download = 'detection-result.jpg'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="w-full min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <h1 className="text-4xl md:text-5xl font-bold text-foreground">
              Object Detector
            </h1>
            <Badge className="bg-green-500">
              <Zap className="w-3 h-3 mr-1" />
              AI Enhanced
            </Badge>
          </div>
          <p className="text-muted-foreground text-lg">
            Advanced object detection with automatic optimization
          </p>

          {/* Backend Status */}
          <div className="mt-4 flex items-center justify-center gap-2">
            <div className={`w-2 h-2 rounded-full ${optimalConfig ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={optimalConfig ? 'text-green-600' : 'text-red-600'}>
              {useBackend ? '✓ Auto Detection Enabled' : '✗ Backend Offline'}
            </span>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="upload" className="flex gap-2">
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">Upload</span>
            </TabsTrigger>
            <TabsTrigger value="webcam" className="flex gap-2">
              <Camera className="w-4 h-4" />
              <span className="hidden sm:inline">Webcam</span>
            </TabsTrigger>
          </TabsList>

          {/* Upload Tab */}
          <TabsContent value="upload" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Upload Image</CardTitle>
                <CardDescription>
                  Upload a photo for AI-powered object detection
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition cursor-pointer bg-muted/50"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-foreground font-medium">Click to upload or drag and drop</p>
                  <p className="text-muted-foreground text-sm">PNG, JPG up to 10MB</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    title="Upload image file"
                    aria-label="Upload image file"
                    className="hidden"
                  />
                </div>

                {uploadedImage && (
                  <div className="relative w-full bg-muted rounded-lg overflow-hidden">
                    <img
                      src={uploadedImage}
                      alt="Uploaded"
                      className="w-full object-contain max-h-96"
                      crossOrigin="anonymous"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Confidence Threshold: {(confidence * 100).toFixed(0)}%
                  </label>
                  <Slider
                    value={[confidence]}
                    onValueChange={(value) => setConfidence(value[0])}
                    min={0.1}
                    max={1}
                    step={0.05}
                    className="w-full"
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleDetect}
                    disabled={!uploadedImage || loading}
                    className="flex-1"
                  >
                    {loading && <Spinner className="w-4 h-4 mr-2" />}
                    {loading ? 'Detecting...' : 'Detect Objects'}
                  </Button>
                  {uploadedImage && (
                    <Button
                      onClick={resetUpload}
                      variant="outline"
                    >
                      <RotateCw className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Webcam Tab */}
          <TabsContent value="webcam" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Webcam Detection</CardTitle>
                <CardDescription>
                  Use your camera for real-time object detection
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative w-full aspect-video bg-muted rounded-lg overflow-hidden">
                  {webcamActive ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Camera className="w-12 h-12 text-muted-foreground" />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Confidence Threshold: {(confidence * 100).toFixed(0)}%
                  </label>
                  <Slider
                    value={[confidence]}
                    onValueChange={(value) => setConfidence(value[0])}
                    min={0.1}
                    max={1}
                    step={0.05}
                    className="w-full"
                  />
                </div>

                <div className="flex gap-2">
                  {!webcamActive ? (
                    <Button
                      onClick={startWebcam}
                      disabled={loading}
                      className="flex-1"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Start Camera
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={handleWebcamCapture}
                        disabled={loading}
                        className="flex-1"
                      >
                        <Camera className="w-4 h-4 mr-2" />
                        Capture Now
                      </Button>
                      <Button
                        onClick={stopWebcam}
                        variant="outline"
                      >
                        <Square className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Error Message */}
        {error && (
          <Card className="border-destructive mt-4">
            <CardContent className="pt-6">
              <p className="text-destructive text-sm">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {result && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Detection Results</CardTitle>
              {result.config_used && (
                <CardDescription className="text-xs">
                  Config: Confidence {(result.config_used.confidence * 100).toFixed(0)}% | 
                  NMS enabled | Preprocessing enabled
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="relative w-full bg-muted rounded-lg overflow-hidden">
                <canvas
                  ref={resultCanvasRef}
                  className="w-full object-contain"
                />
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">
                    Detected Objects ({result.total})
                  </h3>
                  {Object.keys(result.counts).length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(result.counts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([name, count]) => (
                          <Badge key={name} variant="secondary">
                            {name}: <span className="ml-1 font-bold">{count}</span>
                          </Badge>
                        ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">No objects detected</p>
                  )}
                </div>

                <div className="pt-4 border-t border-border">
                  <p className="text-foreground">
                    <span className="font-semibold text-2xl">{result.total}</span>
                    <span className="text-muted-foreground ml-2">total objects detected</span>
                  </p>
                </div>

                {result.total > 0 && (
                  <Button
                    onClick={downloadResult}
                    variant="outline"
                    className="w-full"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Result
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
