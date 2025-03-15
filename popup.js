// 获取当前标签页中的图片
async function getCurrentTabImages() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_IMAGES' }, (images) => {
      resolve(images || []);
    });
  });
}

// 从后台脚本获取所有图片
async function getAllImages() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_ALL_IMAGES' }, (images) => {
      resolve(images || []);
    });
  });
}

// 更新图片网格
async function updateImageGrid() {
  const imageGrid = document.getElementById('imageGrid');
  imageGrid.innerHTML = '';
  
  // 获取所有图片URL
  const tabImages = await getCurrentTabImages();
  const allImages = await getAllImages();
  const uniqueImages = [...new Set([...tabImages, ...allImages])];
  
  // 更新计数
  document.getElementById('imageCount').textContent = uniqueImages.length;
  
  // 创建图片卡片
  uniqueImages.forEach((url) => {
    const card = document.createElement('div');
    card.className = 'image-card';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = false;
    checkbox.dataset.url = url;
    
    const img = document.createElement('img');
    img.src = url;
    const fileName = url.split('/').pop();
    img.title = fileName;
    
    // 添加图片点击预览功能
    img.addEventListener('click', () => {
      const modal = document.getElementById('imageModal');
      const modalImg = document.getElementById('modalImage');
      modalImg.src = url;
      modal.classList.add('active');
    });
    
    // 创建图片信息区域
    const imageInfo = document.createElement('span');
    imageInfo.className = 'image-info';
    
    // 获取图片尺寸
    img.onload = () => {
      imageInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
    };
    
    card.appendChild(checkbox);
    card.appendChild(img);
    card.appendChild(imageInfo);
    imageGrid.appendChild(card);
  });
}

// 下载选中的图片
function downloadSelectedImages() {
  const selectedUrls = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
    .map(checkbox => checkbox.dataset.url);
  
  console.log('Selected URLs for download:', selectedUrls);
  
  if (selectedUrls.length > 0) {
    console.log('Sending download request to background');
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_IMAGES',
      urls: selectedUrls
    });
  } else {
    console.log('No images selected for download');
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup initialized');
  
  // 点击模态框外部关闭预览
  const modal = document.getElementById('imageModal');
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });

  // 刷新按钮
  document.getElementById('refreshBtn').addEventListener('click', () => {
    console.log('Refresh button clicked');
    chrome.runtime.sendMessage({ type: 'CLEAR_IMAGES' }, () => {
      updateImageGrid();
    });
  });
  
  // 下载按钮
  document.getElementById('downloadBtn').addEventListener('click', () => {
    console.log('Download button clicked');
    downloadSelectedImages();
  });
  
  // 模态框下载按钮
  document.getElementById('modalDownloadBtn').addEventListener('click', () => {
    const modalImg = document.getElementById('modalImage');
    console.log('Modal download button clicked, URL:', modalImg.src);
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_IMAGES',
      urls: [modalImg.src]
    });
  });
  
  // 初始加载图片
  console.log('Starting initial image grid update');
  updateImageGrid();
});