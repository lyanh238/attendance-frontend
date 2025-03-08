"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { saveAs } from "file-saver";
import Papa from "papaparse";

// Component to display student information
const StudentCard = ({ student, isUnknown = false }) => {
  return (
    <div className={`p-4 ${isUnknown ? "bg-yellow-100 hover:bg-yellow-200" : "bg-gray-50 hover:bg-gray-100"} rounded-lg transition-colors`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 ${isUnknown ? "bg-red-500" : "bg-blue-500"} rounded-full flex items-center justify-center text-white font-medium`}>
            {typeof student.name === "string" && student.name.length > 0 ? student.name.charAt(0) : "?"}
          </div>
          <div>
            <h3 className="font-medium text-gray-900">
              {typeof student.name === "string" ? student.name : "Unknown"}
            </h3>
            <p className="text-sm text-gray-500">
              Confidence: {(student.confidence * 100).toFixed(2)}%
            </p>
            <p className="text-sm text-gray-500">
              Confirmed At: {student.confirmationTime}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <img src={student.image} alt={student.name} className="w-16 h-16 rounded-lg object-cover" />
          <img src={student.rawImage} alt="Raw Frame" className="w-16 h-16 rounded-lg object-cover" />
        </div>
      </div>
    </div>
  );
};

export default function FaceRecognition() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const streamRef = useRef(null);

  const [isCameraOn, setIsCameraOn] = useState(false);
  const [attendanceList, setAttendanceList] = useState([]);
  const [unknownList, setUnknownList] = useState([]);
  const [error, setError] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [capturedImage, setCapturedImage] = useState(null);

  // Function to save attendance list and unknown list to CSV
  const saveAttendanceToCSV = () => {
    const currentDate = new Date().toISOString().split("T")[0];
    const csvData = [
      ["Name", "Student Id", "Class", "Date", "Time", "Status"],
      ...attendanceList.map(student => [
        student.name,
        student.studentId || "", // Default empty if no ID
        student.class || "", // Default empty if no class
        currentDate,
        student.confirmationTime,
        "Present"
      ]),
      ...unknownList.map(student => [
        student.name || "Unknown",
        "", // No student ID for unknown
        "", // No class for unknown
        currentDate,
        student.confirmationTime,
        "Unknown"
      ])
    ];

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, `attendance_${currentDate}.csv`);
  };
  
  // Get available cameras
  useEffect(() => {
    const getCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((device) => device.kind === "videoinput");
        setCameras(videoDevices);
        if (videoDevices.length > 0) setSelectedCamera(videoDevices[0].deviceId);
      } catch (error) {
        setError("Failed to get cameras");
      }
    };
    getCameras();
  }, []);

  // Connect to WebSocket
  useEffect(() => {
    socketRef.current = new WebSocket("ws://localhost:8000/ws/face-recognition");

    socketRef.current.onopen = () => console.log("WebSocket connected");

    socketRef.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.success) {
        setAttendanceList((prev) => [...prev, ...data.results.filter(r => r.name !== "Unknown")]);
        setUnknownList((prev) => [...prev, ...data.results.filter(r => r.name === "Unknown")]);
      } else {
        setError(data.error);
      }
    };

    socketRef.current.onclose = () => console.log("WebSocket disconnected");

    return () => {
      socketRef.current.close();
    };
  }, []);

  // Start camera with selected device
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: selectedCamera },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsCameraOn(true);
      }
    } catch (error) {
      console.error("Error starting webcam:", error);
      setError("Failed to start webcam");
    }
  }, [selectedCamera]);
  // Clear attendance list
  const clearAttendanceList = () => {
    setAttendanceList([]);
    setUnknownList([]);
  };
  // Stop camera and capture image
  const stopCamera = useCallback(async () => {
    if (streamRef.current) {
      const stream = streamRef.current;
      const tracks = stream.getTracks();

      // Capture the image before stopping the camera
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(async (blob) => {
        setCapturedImage(blob);
        try {
          const formData = new FormData();
          formData.append("file", blob, "capture.jpg");

          const response = await fetch("http://localhost:8000/api/face-recognition", {
            method: "POST",
            body: formData,
          });

          const data = await response.json();
          if (data.success) {
            // Crop faces from the frame
            const croppedImages = await cutImagesFromFrame(blob, data.results);

            // Update attendance and unknown lists
            setAttendanceList((prevList) => {
              const newList = [...prevList];
              const unknownStudents = [];

              croppedImages.forEach((student) => {
                const studentName = student.name === "Unknown" ? generateRandomId() : student.name;
                const studentWithImage = {
                  name: studentName,
                  confidence: student.confidence,
                  image: student.image,
                  rawImage: URL.createObjectURL(blob),
                  confirmationTime: new Date().toLocaleTimeString(),
                };

                if (student.name === "Unknown") {
                  unknownStudents.push(studentWithImage);
                } else if (!newList.some((s) => s.name === studentWithImage.name)) {
                  newList.push(studentWithImage);
                }
              });

              setUnknownList((prevUnknownList) => [
                ...prevUnknownList,
                ...unknownStudents,
              ]);

              return newList;
            });
          } else {
            setError(data.error);
          }
        } catch (err) {
          setError("Failed to send image");
        }
      }, "image/jpeg");

      // Stop all tracks
      tracks.forEach((track) => track.stop());
      setIsCameraOn(false);
    }
  }, []);

  // Crop faces from the frame
  const cutImagesFromFrame = async (imageBlob, results) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const image = await createImageBitmap(imageBlob);

    const croppedImages = [];
    const padding = 20;

    for (const result of results) {
      const { bbox, name, confidence } = result;

      const x = Math.max(0, bbox[0] - padding);
      const y = Math.max(0, bbox[1] - padding);
      const width = Math.min(image.width, bbox[2] + padding - bbox[0]);
      const height = Math.min(image.height, bbox[3] + padding - bbox[1]);

      canvas.width = width;
      canvas.height = height;

      context.drawImage(image, x, y, width, height, 0, 0, width, height);

      const croppedImageBlob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.8);
      });

      const imageURL = URL.createObjectURL(croppedImageBlob);
      croppedImages.push({ name, confidence, image: imageURL });
    }

    return croppedImages;
  };

  // Generate random ID for unknown faces
  const generateRandomId = () => {
    return `Unknown-${Math.random().toString(36).substr(2, 9)}`;
  };

  // Handle camera change
  const handleCameraChange = (event) => {
    setSelectedCamera(event.target.value);
  };

  // Stop camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">Face Recognition Attendance</h1>
        </div>

        <div className="text-center mb-6">
          <button className="px-6 py-2 bg-blue-500 text-white rounded-lg" onClick={saveAttendanceToCSV}>
            Save Attendance CSV
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-center gap-4">
            {/* Camera selection dropdown */}
            <select
              className="px-4 py-2 border rounded-lg"
              onChange={handleCameraChange}
              value={selectedCamera}
            >
              {cameras.map((camera) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label || `Camera ${camera.deviceId}`}
                </option>
              ))}
            </select>

            {/* Start camera button */}
            <button
              className="px-6 py-2 bg-green-500 text-white rounded-lg"
              onClick={startCamera}
              disabled={isCameraOn}
            >
              Start Camera
            </button>

            {/* Stop camera button */}
            <button
              className="px-6 py-2 bg-red-500 text-white rounded-lg"
              onClick={stopCamera}
              disabled={!isCameraOn}
            >
              Stop Camera & Recognize
            </button>

            {/* Clear Log */}
            <button
              className="px-6 py-2 bg-yellow-500 text-white rounded-lg"
              onClick={clearAttendanceList}            >
              Clear Attendant List
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8">
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <h2 className="text-lg font-semibold p-4 border-b">Live Camera Feed</h2>
            <div className="aspect-video bg-gray-900 relative">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              {!isCameraOn && <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 text-white">Camera is off</div>}
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </div>
        </div>

        {/* Attendance list */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Attendance List</h2>
          <div className="space-y-3">
            {attendanceList.map((student, index) => (
              <StudentCard key={index} student={student} />
            ))}
          </div>
        </div>

        {/* Unknown faces list */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Unknown Faces</h2>
          <div className="space-y-3">
            {unknownList.map((student, index) => (
              <StudentCard key={index} student={student} isUnknown />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}