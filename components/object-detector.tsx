'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Slider } from './ui/slider'
import { Badge } from './ui/badge'
import { Spinner } from './ui/spinner'
import { Upload, Camera, Play, Square, RotateCw, Download } from 'lucide-react'
import * as cocoSsd from '@tensorflow-models/coco-ssd'
import '@tensorflow/tfjs'

interface Detection {
  bbox: [number, number, number, number]
  class: string
  score: number
}

interface DetectionResult {
  counts: Record<string, number>
  total: number
  detections: Detection[]
}

export function ObjectDetector() {
  const [activeTab, setActiveTab] = useState('upload')
  const [loading, setLoading] = useState(false)
  const [modelLoading, setModelLoading] = useState(true)
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [confidence, setConfidence] = useState(0.5)
  const [error, setError] = useState('')
  const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const resultCanvasRef = useRef<HTMLCanvasElement>(null)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const [webcamActive, setWebcamActive] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const webcamDetectionIntervalRef = useRef<number | null>(null)
  const webcamDetectionBusyRef = useRef(false)

  // Load the COCO-SSD model on mount
  useEffect(() => {
    const loadModel = async () => {
      try {
        setModelLoading(true)
        const loadedModel = await cocoSsd.load()
        setModel(loadedModel)
        setModelLoading(false)
      } catch (err) {
        setError('Failed to load AI model. Please refresh the page.')
        setModelLoading(false)
      }
    }
    loadModel()
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
        setError('Camera started, but autoplay was blocked. Tap Capture or Start Camera again.')
      })
    }
  }, [cameraStream])

  const drawDetectionsOnCanvas = useCallback((
    canvas: HTMLCanvasElement,
    image: HTMLImageElement | HTMLVideoElement,
    detections: Detection[]
  ) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Get the natural/native dimensions of the source
    const width = image instanceof HTMLVideoElement ? image.videoWidth : image.naturalWidth
    const height = image instanceof HTMLVideoElement ? image.videoHeight : image.naturalHeight

    // Set canvas to match source natural dimensions
    canvas.width = width
    canvas.height = height

    // Draw the image at full resolution
    ctx.drawImage(image, 0, 0, width, height)

    // Detection coordinates are already in natural image space (from temp canvas)
    detections.forEach((detection) => {
      const [x, y, bboxWidth, bboxHeight] = detection.bbox
      
      // Draw bounding box
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = Math.max(2, Math.round(width / 300))
      ctx.strokeRect(x, y, bboxWidth, bboxHeight)

      // Draw label background
      const label = `${detection.class} ${(detection.score * 100).toFixed(0)}%`
      const fontSize = Math.max(14, Math.round(width / 50))
      ctx.font = `bold ${fontSize}px sans-serif`
      const textWidth = ctx.measureText(label).width
      const labelHeight = fontSize + 8
      ctx.fillStyle = '#3b82f6'
      ctx.fillRect(x, y - labelHeight, textWidth + 10, labelHeight)

      // Draw label text
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, x + 5, y - 6)
    })
  }, [])

  const detectObjects = useCallback(async (
    source: HTMLImageElement | HTMLVideoElement
  ) => {
    if (!model) {
      setError('Model not loaded yet')
      return
    }

    setLoading(true)
    setError('')

    try {
      // For images, create a temporary canvas at full resolution to ensure accurate detection
      let detectionSource: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement = source
      
      if (source instanceof HTMLImageElement) {
        // Create a canvas with full image resolution for accurate detection
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = source.naturalWidth
        tempCanvas.height = source.naturalHeight
        const tempCtx = tempCanvas.getContext('2d')
        if (tempCtx) {
          tempCtx.drawImage(source, 0, 0, source.naturalWidth, source.naturalHeight)
          detectionSource = tempCanvas as unknown as HTMLImageElement
        }
      }
      
      const predictions = await model.detect(detectionSource)
      
      // Filter by confidence threshold
      const filtered = predictions.filter(p => p.score >= confidence) as Detection[]

      // Count objects by class
      const counts: Record<string, number> = {}
      filtered.forEach(det => {
        counts[det.class] = (counts[det.class] || 0) + 1
      })

      const result: DetectionResult = {
        counts,
        total: filtered.length,
        detections: filtered
      }

      setResult(result)

      // Draw detections on result canvas using original source for display
      if (resultCanvasRef.current) {
        drawDetectionsOnCanvas(resultCanvasRef.current, source, filtered)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed')
    } finally {
      setLoading(false)
    }
  }, [model, confidence])

  const detectWebcamFrame = useCallback(async () => {
    if (!model || !videoRef.current || !webcamActive) return
    if (videoRef.current.readyState < 2) return
    if (webcamDetectionBusyRef.current) return

    webcamDetectionBusyRef.current = true

    try {
      const predictions = await model.detect(videoRef.current)
      const filtered = predictions.filter(p => p.score >= confidence) as Detection[]

      const counts: Record<string, number> = {}
      filtered.forEach(det => {
        counts[det.class] = (counts[det.class] || 0) + 1
      })

      setResult({
        counts,
        total: filtered.length,
        detections: filtered
      })

      if (resultCanvasRef.current && videoRef.current) {
        drawDetectionsOnCanvas(resultCanvasRef.current, videoRef.current, filtered)
      }
    } catch {
      // Keep webcam loop alive even if a single frame fails.
    } finally {
      webcamDetectionBusyRef.current = false
    }
  }, [model, webcamActive, confidence, drawDetectionsOnCanvas])

  useEffect(() => {
    if (!webcamActive || !model) return

    if (webcamDetectionIntervalRef.current) {
      window.clearInterval(webcamDetectionIntervalRef.current)
    }

    webcamDetectionIntervalRef.current = window.setInterval(() => {
      void detectWebcamFrame()
    }, 500)

    return () => {
      if (webcamDetectionIntervalRef.current) {
        window.clearInterval(webcamDetectionIntervalRef.current)
        webcamDetectionIntervalRef.current = null
      }
      webcamDetectionBusyRef.current = false
    }
  }, [webcamActive, model, detectWebcamFrame])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const imageData = event.target?.result as string
      setUploadedImage(imageData)
      setResult(null)
    }
    reader.readAsDataURL(file)
  }

  const handleImageLoad = () => {
    if (imageRef.current && model) {
      detectObjects(imageRef.current)
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
      setError('Unable to access camera. Please allow camera permission and use localhost or HTTPS.')
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
    setWebcamActive(false)
  }

  const captureFrame = async () => {
    if (!videoRef.current) return
    await detectObjects(videoRef.current)
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
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-2 text-balance">
            Object Detector
          </h1>
          <p className="text-muted-foreground text-lg">
            AI-powered real-time object detection and counting
          </p>
          {modelLoading && (
            <div className="flex items-center justify-center gap-2 mt-4 text-muted-foreground">
              <Spinner className="w-4 h-4" />
              <span>Loading AI model...</span>
            </div>
          )}
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
                  Upload a photo to detect and count objects
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
                    className="hidden"
                  />
                </div>

                {uploadedImage && (
                  <div className="relative w-full bg-muted rounded-lg overflow-hidden">
                    <img
                      ref={imageRef}
                      src={uploadedImage}
                      alt="Uploaded"
                      className="w-full object-contain max-h-96"
                      onLoad={handleImageLoad}
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
                    onClick={() => imageRef.current && detectObjects(imageRef.current)}
                    disabled={!uploadedImage || loading || modelLoading}
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
                      disabled={loading || modelLoading}
                      className="flex-1"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Start Camera
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={captureFrame}
                        disabled={loading || modelLoading}
                        className="flex-1"
                      >
                        {loading && <Spinner className="w-4 h-4 mr-2" />}
                        {loading ? 'Detecting...' : 'Capture & Detect'}
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
              <p className="text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {result && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Detection Results</CardTitle>
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
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Detected Objects</h3>
                  {Object.keys(result.counts).length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(result.counts).map(([name, count]) => (
                        <Badge key={name} variant="secondary">
                          {name}: {count}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">No objects detected above confidence threshold</p>
                  )}
                </div>

                <div className="pt-4 border-t border-border">
                  <p className="text-foreground">
                    <span className="font-semibold text-lg">{result.total}</span>
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
