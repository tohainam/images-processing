import { useState, useEffect, useRef } from 'react';
import * as faceapi from 'face-api.js';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.min.css';
import './css/ImageHandler.css';

const A4_WIDTH = 2480;
const A4_HEIGHT = 3508;
const PADDING_LEFT_RIGHT = 154;
const PADDING_TOP = 82;
const PADDING_BOTTOM = 114;
const IMG_WIDTH = (A4_WIDTH - 2 * PADDING_LEFT_RIGHT) / 2;
const IMG_HEIGHT = (A4_HEIGHT - PADDING_TOP - PADDING_BOTTOM) / 5;

const loadModels = async () => {
    await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('weights'),
        faceapi.nets.faceLandmark68Net.loadFromUri('weights'),
        faceapi.nets.faceRecognitionNet.loadFromUri('weights'),
    ]);
    console.log('Face-api.js models loaded');
};

const processFiles = async (files) => {
    const newImageFiles = [];
    for (const file of files) {
        if (file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
            const zip = await JSZip.loadAsync(file);
            for (const relativePath in zip.files) {
                const zipEntry = zip.files[relativePath];
                if (!zipEntry.dir && /\.(jpe?g|png)$/i.test(zipEntry.name)) {
                    const blob = await zipEntry.async('blob');
                    newImageFiles.push(new File([blob], zipEntry.name, { type: blob.type }));
                }
            }
        } else if (file.type.startsWith('image/')) {
            newImageFiles.push(file);
        }
    }
    return newImageFiles;
};

const createButton = (text, className, onClick) => {
    const button = document.createElement('button');
    button.classList.add(className);
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
};

const createCropper = (image, viewMode) => {
    return new Cropper(image, {
        aspectRatio: 5.6 / 9.2,
        viewMode: viewMode,
        autoCropArea: 1,
        ready: async function () {
            const detections = await faceapi.detectAllFaces(image, new faceapi.TinyFaceDetectorOptions());
            if (detections.length > 0) {
                const face = detections[0].box;
                const cropBoxData = calculateCropBoxData(this.cropper, face);
                this.cropper.setCropBoxData(cropBoxData);
            } else {
                const cropBoxData = calculateDefaultCropBoxData(this.cropper);
                this.cropper.setCropBoxData(cropBoxData);
            }
            if (this.cropper.getImageData().width < this.cropper.getImageData().height) {
                this.cropper.rotate(90);
            }
        },
    });
};

const calculateCropBoxData = (cropper, face) => {
    const cropBoxData = cropper.getCropBoxData();
    const imageData = cropper.getImageData();
    const newCropBoxWidth = cropBoxData.width;
    const newCropBoxHeight = (newCropBoxWidth / 5.6) * 9.2;
    const centerX = face.x + face.width / 2;
    const centerY = face.y + face.height / 2;
    const cropX = Math.max(0, Math.min(centerX - newCropBoxWidth / 2, imageData.width - newCropBoxWidth));
    const cropY = Math.max(0, Math.min(centerY - newCropBoxHeight / 2, imageData.height - newCropBoxHeight));
    return { left: cropX, top: cropY, width: newCropBoxWidth, height: newCropBoxHeight };
};

const calculateDefaultCropBoxData = (cropper) => {
    const containerData = cropper.getContainerData();
    const cropBoxData = cropper.getCropBoxData();
    const newCropBoxWidth = cropBoxData.width;
    const newCropBoxHeight = (newCropBoxWidth / 5.6) * 9.2;
    const cropX = (containerData.width - newCropBoxWidth) / 2;
    const cropY = (containerData.height - newCropBoxHeight) / 2;
    return { left: cropX, top: cropY, width: newCropBoxWidth, height: newCropBoxHeight };
};

const ImageHandler = () => {
    const [croppers, setCroppers] = useState([]);
    const [imageFiles, setImageFiles] = useState([]);
    const [showOutputName, setShowOutputName] = useState(false);
    const [libraryVisible, setLibraryVisible] = useState(true);
    const outputNameRef = useRef(null);

    useEffect(() => {
        loadModels();
    }, []);

    const handleFiles = async (files) => {
        const newImageFiles = await processFiles(files);
        setImageFiles(newImageFiles);
        initializeCroppers(newImageFiles);
        setShowOutputName(newImageFiles.length > 0);
    };

    const initializeCroppers = (files) => {
        const newCroppers = [];
        const previewContainer = document.getElementById('previewContainer');
        previewContainer.innerHTML = '';

        files.forEach((file, index) => {
            const url = URL.createObjectURL(file);
            const imageContainer = createImageContainer(url, index, newCroppers);
            previewContainer.appendChild(imageContainer);
            const cropper = createCropper(document.getElementById(`image-${index}`), 1);
            newCroppers.push(cropper);
        });

        setCroppers(newCroppers);
        document.getElementById('combineButton').style.display = 'inline-block'; // Show the download button
    };

    const createImageContainer = (url, index, newCroppers) => {
        const imageContainer = document.createElement('div');
        imageContainer.classList.add('image-container');

        const image = document.createElement('img');
        image.src = url;
        image.id = `image-${index}`;
        imageContainer.appendChild(image);

        const rotateButton = createButton('↻', 'rotate-button', () => {
            newCroppers[index].rotate(90);
        });
        imageContainer.appendChild(rotateButton);

        const viewModeButton = createButton('🔍', 'viewmode-button', () => {
            const cropper = newCroppers[index];
            const newViewMode = cropper.options.viewMode === 0 ? 1 : 0;
            viewModeButton.textContent = newViewMode === 0 ? '🔍' : '🔍';
            cropper.destroy();
            newCroppers[index] = createCropper(image, newViewMode);
            setLibraryVisible(newViewMode === 1);
        });
        imageContainer.appendChild(viewModeButton);

        const deleteButton = createButton('🗑️', 'delete-button', () => {
            imageContainer.remove();
            newCroppers.splice(index, 1);
            setCroppers([...newCroppers]);
        });
        imageContainer.appendChild(deleteButton);

        return imageContainer;
    };

    const combineImages = () => {
        if (!showOutputName) {
            setShowOutputName(true);
            outputNameRef.current.focus();
            return;
        }

        document.querySelectorAll('.download-link').forEach(link => link.remove());

        const totalPages = Math.ceil(croppers.length / 10);
        let currentPage = 0;

        const createPage = () => {
            const canvas = document.createElement('canvas');
            canvas.width = A4_WIDTH;
            canvas.height = A4_HEIGHT;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

            const start = currentPage * 10;
            const end = Math.min(start + 10, croppers.length);

            for (let i = start; i < end; i++) {
                const cropper = croppers[i];
                const croppedCanvas = cropper.getCroppedCanvas();
                const tempCanvas = document.createElement('canvas');
                const tempCtx = tempCanvas.getContext('2d');
                tempCanvas.width = croppedCanvas.height;
                tempCanvas.height = croppedCanvas.width;
                tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
                tempCtx.rotate((90 * Math.PI) / 180);
                tempCtx.drawImage(croppedCanvas, -croppedCanvas.width / 2, -croppedCanvas.height / 2);

                const x = PADDING_LEFT_RIGHT + (i % 2) * IMG_WIDTH;
                const y = PADDING_TOP + Math.floor((i % 10) / 2) * IMG_HEIGHT;
                ctx.drawImage(tempCanvas, x, y, IMG_WIDTH, IMG_HEIGHT);
            }

            canvas.toBlob((blob) => {
                const outputName = outputNameRef.current.value.trim() || Date.now().toString();
                const fileName = `${outputName}-page-${currentPage + 1}.jpg`;
                saveAs(blob, fileName);

                currentPage++;
                if (currentPage < totalPages) {
                    createPage();
                }
            }, 'image/jpeg');
        };

        createPage();
    };

    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.add('dragover');
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('dragover');
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    };

    return (
        <div className="container">
            <h1>Combine and Crop Images</h1>
            <div
                className="file-input"
                id="dragDropArea"
                onDragOver={(e) => e.preventDefault()}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <input type="file" id="inputImages" accept="image/*, .zip" multiple onChange={(e) => handleFiles(e.target.files)} />
                <label htmlFor="inputImages">Drag and drop files here or click to choose</label>
            </div>

            {libraryVisible && (
                <div id="previewContainer" className="preview"></div>
            )}
            <div className="download">
                {showOutputName && (
                <div className="output-name">
                    <input type="text" id="outputName" ref={outputNameRef} placeholder="Enter output file name" />
                </div>
            )}
                <div className="buttons">
                    <button id="combineButton" onClick={combineImages}>
                        {showOutputName ? 'Download' : 'Combine and Download'}
                    </button>
                </div></div>

        </div>
    );
};

export default ImageHandler;