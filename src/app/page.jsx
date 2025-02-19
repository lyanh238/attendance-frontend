"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export default function FaceRecognition() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const socketRef = useRef(null);
  const latestFrameRef = useRef(null);

  // States
  const [isStreaming, setIsStreaming] = useState(false);
  const [attendanceList, setAttendanceList] = useState([]); // Danh sách điểm danh
  const [unknownList, setUnknownList] = useState([]); // Danh sách Unknown
  const [error, setError] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState("");

  // Thống kê request
  const [successfulRequests, setSuccessfulRequests] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const pendingRequestsRef = useRef(0); // Sử dụng useRef để theo dõi requests đang chờ

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame to canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert canvas to blob
    return new Promise((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.8);
    });
  }, []);

  // Get available cameras
  useEffect(() => {
    const getCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(
          (device) => device.kind === "videoinput"
        );
        setCameras(videoDevices);
        if (videoDevices.length > 0) {
          setSelectedCamera(videoDevices[0].deviceId);
        }
      } catch (error) {
        console.error("Error getting cameras:", error);
        setError("Failed to get cameras");
      }
    };

    getCameras();
  }, []);

  // Kết nối đến WebSocket
  useEffect(() => {
    socketRef.current = new WebSocket(
    `wss://${process.env.NEXT_PUBLIC_NGROK_LINK}/ws/face-recognition`
    );

    socketRef.current.onopen = () => {
      console.log("WebSocket connected");
      setStartTime(Date.now()); // Bắt đầu thời gian khi kết nối
    };

    socketRef.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      console.log("Received data from WebSocket:", data);
      pendingRequestsRef.current = Math.max(0, pendingRequestsRef.current - 1); // Giảm số request đang chờ

      if (data.success) {
        // Lưu ảnh của học sinh tại thời điểm xác nhận
        const imageBlob = await captureFrame(); // Lưu lại ảnh từ frame hiện tại
        const imageURL = URL.createObjectURL(imageBlob); // Tạo URL cho ảnh

        // Cắt mặt từ ảnh raw
        const croppedImages = await cutImagesFromFrame(imageBlob, data.results);
        const currentTime = new Date().toLocaleTimeString(); // Lưu thời gian xác nhận

        // Cập nhật danh sách điểm danh cho từng học sinh
        setAttendanceList((prevList) => {
          const newList = [...prevList];
          const unknownStudents = []; // Danh sách học sinh Unknown

          croppedImages.forEach((student) => {
            const studentName =
              student.name === "Unknown" ? generateRandomId() : student.name; // Thay đổi tên nếu là "Unknown"
            const studentWithImage = {
              name: studentName,
              confidence: student.confidence,
              image: student.image, // Sử dụng ảnh cắt
              rawImage: imageURL, // Thêm ảnh raw
              confirmationTime: currentTime, // Thêm thời gian xác nhận
            };

            // Kiểm tra xem học sinh đã có trong danh sách chưa
            if (student.name === "Unknown") {
              unknownStudents.push(studentWithImage); // Thêm vào danh sách Unknown
            } else if (!newList.some((s) => s.name === studentWithImage.name)) {
              newList.push(studentWithImage); // Thêm học sinh mới vào danh sách
            }
          });

          // Cập nhật danh sách học sinh Unknown
          setUnknownList((prevUnknownList) => [
            ...prevUnknownList,
            ...unknownStudents,
          ]);

          return newList;
        });

        setSuccessfulRequests((prev) => prev + 1); // Tăng số request thành công
      } else {
        setError(data.error);
      }
    };

    socketRef.current.onclose = () => {
      console.log("WebSocket disconnected");
    };

    return () => {
      socketRef.current.close();
    };
  }, [captureFrame]);

  // Cắt mặt từ ảnh raw
  const cutImagesFromFrame = async (imageBlob, results) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const image = await createImageBitmap(imageBlob);

    const croppedImages = [];
    const padding = 20; // Giá trị padding để cắt rộng hơn

    for (const result of results) {
      const { bbox, name, confidence } = result;

      // Tính toán kích thước của ảnh cắt với padding
      const x = Math.max(0, bbox[0] - padding);
      const y = Math.max(0, bbox[1] - padding);
      const width = Math.min(image.width, bbox[2] + padding - bbox[0]);
      const height = Math.min(image.height, bbox[3] + padding - bbox[1]);

      // Cài đặt kích thước canvas
      canvas.width = width;
      canvas.height = height;

      // Vẽ ảnh cắt lên canvas
      context.drawImage(image, x, y, width, height, 0, 0, width, height);

      // Lưu ảnh cắt vào mảng
      const croppedImageBlob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.8);
      });

      const imageURL = URL.createObjectURL(croppedImageBlob);
      croppedImages.push({ name, confidence, image: imageURL }); // Thêm ảnh cắt vào mảng
    }

    return croppedImages;
  };

  // Sinh mã số ngẫu nhiên
  const generateRandomId = () => {
    return Math.floor(Math.random() * 1000000); // Sinh mã số ngẫu nhiên từ 0 đến 999999
  };

  // Start frame capture
  const startFrameCapture = useCallback(() => {
    intervalRef.current = setInterval(async () => {
      const blob = await captureFrame();
      if (blob) {
        latestFrameRef.current = blob;

        // Gửi hình ảnh đến server qua WebSocket nếu số request đang chờ < 5
        if (
          socketRef.current &&
          socketRef.current.readyState === WebSocket.OPEN &&
          pendingRequestsRef.current < 5
        ) {
          console.log("Sending frame to server");
          pendingRequestsRef.current += 1; // Tăng số request đang chờ
          socketRef.current.send(await blob.arrayBuffer());
        }
      }
    }, 200); // 200ms per frame capture
  }, [captureFrame]);

  // Start webcam
  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: selectedCamera },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsStreaming(true);
        startFrameCapture();
      }
    } catch (error) {
      console.error("Error starting webcam:", error);
      setError("Failed to start webcam");
    }
  };

  // Stop webcam
  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsStreaming(false);
  };

  // Tính toán Requests mỗi giây
  const calculateRPS = () => {
    if (!startTime) return 0;
    const elapsedTime = (Date.now() - startTime) / 1000; // Tính thời gian đã chạy (s)
    return elapsedTime > 0 ? (successfulRequests / elapsedTime).toFixed(2) : 0;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopWebcam();
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header Section */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            AI Face Recognition Attendance System
          </h1>
          <p className="text-gray-600 text-lg">
            Real-time attendance tracking with advanced AI technology
          </p>
        </div>

        <div className="flex items-center gap-3 bg-gray-50 px-4 py-2 rounded-lg">
          <span className="text-sm text-gray-600">
            Successful Requests: {successfulRequests}
          </span>
          <div className="h-5 w-px bg-gray-300"></div>
          <span className="text-sm text-gray-600">
            RPS: {calculateRPS()} req/s
          </span>
        </div>

        {/* Control Panel */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <select
                className="min-w-[200px] px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                value={selectedCamera}
                onChange={(e) => setSelectedCamera(e.target.value)}
                disabled={isStreaming}
              >
                <option value="" disabled>
                  Select Camera
                </option>
                {cameras.map((camera) => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {camera.label || `Camera ${camera.deviceId}`}
                  </option>
                ))}
              </select>

              <button
                className={`px-6 py-2.5 rounded-lg font-medium transition-all duration-200 flex items-center gap-2
                  ${
                    isStreaming
                      ? "bg-red-500 hover:bg-red-600 text-white"
                      : "bg-blue-500 hover:bg-blue-600 text-white"
                  }`}
                onClick={isStreaming ? stopWebcam : startWebcam}
              >
                {isStreaming ? "Stop Camera" : "Start Camera"}
              </button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Video Feed */}
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                Live Camera Feed
              </h2>
            </div>
            <div className="aspect-video bg-gray-900 relative">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              {!isStreaming && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50">
                  <p className="text-white text-lg">Camera is offline</p>
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </div>
        </div>

        {/* Attendance Panel for Known Students */}
        <div className="bg-white rounded-xl shadow-lg mt-8">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">
              Attendance List (Known Students)
            </h2>
          </div>
          <div className="p-6">
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-100 rounded-lg flex items-center gap-3">
                <span className="text-red-600">{error}</span>
              </div>
            )}

            <div className="space-y-3">
              {attendanceList.map((student, index) => (
                <div
                  key={index}
                  className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
                        {typeof student.name === "string" &&
                        student.name.length > 0
                          ? student.name.charAt(0)
                          : "?"}
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">
                          {typeof student.name === "string"
                            ? student.name
                            : "Unknown"}
                        </h3>
                        <p className="text-sm text-gray-500">
                          Confidence: {(student.confidence * 100).toFixed(2)}%
                        </p>
                        <p className="text-sm text-gray-500">
                          Confirmed At: {student.confirmationTime}{" "}
                          {/* Thời gian xác nhận */}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <img
                        src={student.image}
                        alt={student.name}
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                      <img
                        src={student.rawImage}
                        alt="Raw Frame"
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Attendance Panel for Unknown Students */}
        <div className="bg-white rounded-xl shadow-lg mt-8">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">
              Attendance List (Unknown Students)
            </h2>
          </div>
          <div className="p-6">
            <div className="space-y-3">
              {unknownList.map((student, index) => (
                <div
                  key={index}
                  className="p-4 bg-yellow-100 rounded-lg hover:bg-yellow-200 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center text-white font-medium">
                        ?
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Unknown</h3>
                        <p className="text-sm text-gray-500">
                          Confidence: {(student.confidence * 100).toFixed(2)}%
                        </p>
                        <p className="text-sm text-gray-500">
                          Confirmed At: {student.confirmationTime}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <img
                        src={student.image}
                        alt="Unknown"
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                      <img
                        src={student.rawImage}
                        alt="Raw Frame"
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
