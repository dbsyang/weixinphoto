// 存储所有图片数据
let allImageData = [];

// 滑块值映射
const sizeSliderMap = {
  0: { label: '全部图片', value: 0 },
  10: { label: '> 200px', value: 200 },
  20: { label: '> 400px', value: 400 },
  30: { label: '> 600px', value: 600 },
  40: { label: '> 800px', value: 800 },
  50: { label: '> 1000px', value: 1000 },
  60: { label: '> 1200px', value: 1200 },
  70: { label: '> 1400px', value: 1400 },
  80: { label: '> 1600px', value: 1600 },
  90: { label: '> 1800px', value: 1800 },
  100: { label: '> 2000px', value: 2000 }
};

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

// 计算排序值
function calculateSortValue(image, sortType) {
  switch (sortType) {
    case 'area-desc':
      return -(image.width * image.height);
    case 'area-asc':
      return image.width * image.height;
    case 'width-desc':
      return -image.width;
    case 'width-asc':
      return image.width;
    case 'height-desc':
      return -image.height;
    case 'height-asc':
      return image.height;
    default:
      return 0;
  }
}

// 尺寸过滤器更新函数
function updateSizeFilter() {
  try {
    const minSizeSlider = document.getElementById('minSizeSlider');
    const sizeDisplay = document.getElementById('minSizeValue');
    
    if (!minSizeSlider) return;
    
    const sliderValue = parseInt(minSizeSlider.value || 0);
    
    // 将滑块值映射到像素值，使用指数函数使得控制更精确
    const minPixels = Math.floor(Math.pow(sliderValue / 100, 2) * 2000);
    
    if (sliderValue === 0) {
      if (sizeDisplay) {
        sizeDisplay.textContent = '全部图片';
      }
    } else {
      if (sizeDisplay) {
        sizeDisplay.textContent = `>${minPixels}px`;
      }
    }
    
    applyFiltersAndSort();
  } catch (error) {
    console.error('更新尺寸过滤器错误:', error);
  }
}

// 获取尺寸滑块的实际过滤值
function getSizeFilterValue() {
  try {
    const minSizeSlider = document.getElementById('minSizeSlider');
    if (!minSizeSlider) return 0;
    
    const sliderValue = parseInt(minSizeSlider.value || 0);
    
    if (sliderValue === 0) {
      return 0; // 不过滤
    }
    
    return Math.floor(Math.pow(sliderValue / 100, 2) * 2000);
  } catch (error) {
    console.error('获取尺寸过滤值错误:', error);
    return 0;
  }
}

// 获取比例滑块的值并转换为比例范围
function getRatioFilterValues() {
  try {
    const ratioSlider = document.getElementById('ratioSlider');
    if (!ratioSlider) return { min: 0, max: Infinity, label: '全部' };
    
    const value = parseInt(ratioSlider.value || 0);
    
    // 初始位置 (0) 表示所有比例
    if (value === 0) {
      return { min: 0, max: Infinity, label: '全部' };
    } else if (value < 25) {
      return { min: 0, max: 0.8, label: '纵向 (高>宽)' }; // 纵向图片
    } else if (value < 50) {
      return { min: 0.8, max: 1.05, label: '接近正方形-纵向' };
    } else if (value < 75) {
      return { min: 1.05, max: 1.25, label: '接近正方形-横向' };
    } else {
      return { min: 1.25, max: Infinity, label: '横向 (宽>高)' }; // 横向图片
    }
  } catch (error) {
    console.error('获取比例过滤值错误:', error);
    return { min: 0, max: Infinity, label: '全部' };
  }
}

// 更新滑块显示值
function updateSliderLabels() {
  try {
    const ratioSlider = document.getElementById('ratioSlider');
    const ratioValue = document.getElementById('ratioValue');
    
    // 更新宽高比滑块显示
    if (ratioSlider) {
      const ratioFilter = getRatioFilterValues();
      if (ratioValue && ratioFilter) {
        ratioValue.textContent = ratioFilter.label;
      }
    }
    
    // 应用过滤器
    applyFiltersAndSort();
  } catch (error) {
    console.error('更新滑块标签错误:', error);
  }
}

// 检查图片是否符合尺寸过滤条件
function meetsSizeFilter(image, minSize) {
  return Math.max(image.width, image.height) >= minSize;
}

// 检查图片是否符合宽高比过滤条件
function meetsRatioFilter(image, ratioFilter) {
  const ratio = image.width / image.height;
  return ratio >= ratioFilter.min && ratio <= ratioFilter.max;
}

// 根据URL检测图片格式
function detectImageFormat(url) {
  // 如果是Data URL
  if (url.startsWith('data:')) {
    const matches = url.match(/^data:image\/([a-zA-Z0-9]+);base64,/);
    if (matches && matches[1]) {
      return matches[1].toUpperCase();
    }
    return 'unknown';
  }
  
  // 检查是否是SVG内部引用或片段
  if (url.startsWith('#') || url === '%23linearGradient-1') {
    return 'SVG_FRAGMENT';
  }
  
  try {
    // 处理URL之前检查它是否是有效的URL
    // 有些URL可能是相对路径或不完整的URL
    let fullUrl = url;
    if (!url.match(/^(https?:\/\/|file:\/\/|data:)/i)) {
      // 如果它不是完整的URL，尝试将其视为相对于当前页面的URL
      try {
        const baseUrl = window.location.href.split('#')[0];
        fullUrl = new URL(url, baseUrl).href;
      } catch (e) {
        console.warn('无法形成有效URL:', url, e);
        return 'unknown';
      }
    }
    
    // 尝试创建URL对象以验证URL是否有效
    const urlObj = new URL(fullUrl);
    
    // 获取文件扩展名
    const pathname = urlObj.pathname;
    const extension = pathname.split('.').pop().toLowerCase();
    
    // 常见图片扩展名映射到格式
    const formatMap = {
      'jpg': 'JPEG',
      'jpeg': 'JPEG',
      'png': 'PNG',
      'gif': 'GIF',
      'webp': 'WEBP',
      'svg': 'SVG',
      'bmp': 'BMP',
      'ico': 'ICO'
    };
    
    return formatMap[extension] || 'unknown';
  } catch (e) {
    console.warn('无效的URL格式:', url, e);
    return 'unknown';
  }
}

// 加载图片获取尺寸
function loadImageAndGetDimensions(url, format, resolve) {
  const img = new Image();
  img.onload = () => {
    resolve({
      url: url,
      width: img.naturalWidth,
      height: img.naturalHeight,
      ratio: img.naturalWidth / img.naturalHeight,
      format: format,
      loaded: true
    });
  };
  img.onerror = () => {
    resolve({
      url: url,
      width: 0,
      height: 0,
      ratio: 1,
      format: 'unknown',
      loaded: false
    });
  };
  img.src = url;
}

// 获取图片的尺寸信息和格式
function getImageDimensions(url) {
  return new Promise((resolve) => {
    // 首先尝试通过URL判断格式
    let format = detectImageFormat(url);
    
    // 如果是SVG片段，直接跳过
    if (format === 'SVG_FRAGMENT') {
      resolve({
        url: url,
        width: 0,
        height: 0,
        loaded: false,
        format: 'SVG_FRAGMENT'
      });
      return;
    }
    
    // 如果通过URL无法确定格式，尝试通过发送请求判断
    if (format === 'unknown') {
      try {
        // 创建HEAD请求获取Content-Type
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', url, true);
        xhr.onreadystatechange = function() {
          if (xhr.readyState === 4) {
            if (xhr.status === 200) {
              const contentType = xhr.getResponseHeader('Content-Type');
              if (contentType) {
                if (contentType.includes('image/jpeg')) {
                  format = 'JPEG';
                } else if (contentType.includes('image/png')) {
                  format = 'PNG';
                } else if (contentType.includes('image/gif')) {
                  format = 'GIF';
                } else if (contentType.includes('image/webp')) {
                  format = 'WEBP';
                } else if (contentType.includes('image/svg+xml')) {
                  format = 'SVG';
                } else if (contentType.includes('image/')) {
                  format = contentType.split('/')[1].toUpperCase();
                }
              }
            }
            
            // 无论头部请求成功与否，继续加载图片获取尺寸
            loadImageAndGetDimensions(url, format, resolve);
          }
        };
        xhr.send(null);
      } catch (e) {
        console.error("Error checking format via HEAD request:", e);
        loadImageAndGetDimensions(url, format, resolve);
      }
    } else {
      // 如果已经通过URL确定了格式，直接加载图片获取尺寸
      loadImageAndGetDimensions(url, format, resolve);
    }
  });
}

// 根据当前过滤器和排序条件更新图片网格
function updateImageGrid() {
  // 获取过滤器元素
  const minSizeSlider = document.getElementById('minSizeSlider');
  const maxSizeSlider = document.getElementById('maxSizeSlider');
  const ratioSlider = document.getElementById('ratioSlider');
  const sortSelect = document.getElementById('sortSelect');
  
  // 设置默认值
  let minWidth = 0;
  let maxWidth = 10000;
  let ratioMin = 0.1;
  let ratioMax = 10;
  let sortType = 'none';
  
  // 安全获取值
  if (minSizeSlider) {
    minWidth = parseInt(minSizeSlider.value) || 0;
  }
  
  if (maxSizeSlider) {
    maxWidth = parseInt(maxSizeSlider.value) || 10000;
  }
  
  if (ratioSlider) {
    const parts = (ratioSlider.value || '0.5-3.0').split('-');
    ratioMin = parseFloat(parts[0]) || 0.1;
    ratioMax = parseFloat(parts[1]) || 10;
  }
  
  if (sortSelect) {
    sortType = sortSelect.value || 'none';
  }
  
  const size = { min: minWidth, max: maxWidth };
  const ratio = { min: ratioMin, max: ratioMax };
  
  // 按尺寸和比例过滤图片
  let filteredImages = allImageData.filter(img => {
    // 检查图片加载状态
    if (!img || !img.loaded) {
      return false;
    }
    
    // 检查图片尺寸
    if (!(img.width >= size.min && img.width <= size.max)) {
      return false;
    }
    
    // 检查图片比例
    const imageRatio = img.width / img.height;
    if (!(imageRatio >= ratio.min && imageRatio <= ratio.max)) {
      return false;
    }
    
    return true;
  });
  
  // 排序图片
  if (sortType !== 'none') {
    filteredImages.sort((a, b) => {
      if (!a || !b) return 0;
      return calculateSortValue(a, sortType) - calculateSortValue(b, sortType);
    });
  }
  
  // 更新图片网格
  displayImages(filteredImages);
}

// 下载单张图片
function downloadSingleImage(url) {
  console.log('下载单张图片:', url);
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_IMAGES',
    urls: [url]
  });
  
  // 显示下载状态提示
  const status = document.createElement('div');
  status.textContent = '正在下载图片...';
  status.style.padding = '10px';
  status.style.backgroundColor = '#e6f7e6';
  status.style.borderRadius = '4px';
  status.style.marginTop = '10px';
  status.style.textAlign = 'center';
  
  const toolbar = document.querySelector('.toolbar');
  if (toolbar) {
    toolbar.after(status);
  }
  
  // 3秒后移除状态提示
  setTimeout(() => {
    status.remove();
  }, 2000);
}

// 渲染图片网格
function displayImages(filteredImages) {
  const imageGrid = document.getElementById('imageGrid');
  if (!imageGrid) return;
  
  imageGrid.innerHTML = '';
  
  // 更新计数
  const imageCountEl = document.getElementById('imageCount');
  if (imageCountEl) {
    imageCountEl.textContent = filteredImages.length;
  }
  
  if (filteredImages.length === 0) {
    imageGrid.innerHTML = '<div style="text-align: center; padding: 20px;">没有符合条件的图片</div>';
    return;
  }
  
  // 创建图片卡片
  filteredImages.forEach((imageData) => {
    const card = document.createElement('div');
    card.className = 'card';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'card-checkbox';
    checkbox.dataset.url = imageData.url;
    checkbox.addEventListener('change', () => {
      console.log('复选框直接绑定的change事件');
      updateDownloadButtonText();
    });
    
    const img = document.createElement('img');
    img.src = imageData.url;
    img.loading = 'lazy';
    img.style.cursor = 'pointer';
    img.onclick = (event) => {
      // 阻止事件冒泡，避免触发卡片的其他点击事件
      event.stopPropagation();
      // 切换复选框状态
      checkbox.checked = !checkbox.checked;
      // 触发change事件，确保任何依赖于复选框状态的逻辑都能正确执行
      const changeEvent = new Event('change');
      checkbox.dispatchEvent(changeEvent);
    };
    
    const previewBtn = document.createElement('button');
    previewBtn.className = 'preview-btn';
    previewBtn.textContent = '预览';
    previewBtn.onclick = () => previewImage(imageData.url);
    
    // 创建下载按钮
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'card-download-btn';
    downloadBtn.textContent = '下载';
    downloadBtn.onclick = () => downloadSingleImage(imageData.url);
    
    // 创建标签容器
    const tagContainer = document.createElement('div');
    tagContainer.className = 'tag-container';
    
    // 生成标签
    const tags = getDimensionTags(imageData);
    
    // 添加尺寸标签到容器中
    tags.forEach((tag) => {
      const tagElement = document.createElement('span');
      tagElement.className = 'badge-tag';
      tagElement.textContent = tag.text;
      tagElement.style.backgroundColor = tag.color;
      tagElement.style.color = 'white';
      tagContainer.appendChild(tagElement);
    });
    
    // 添加格式标签 (如果有)
    if (imageData.format && imageData.format !== 'unknown') {
      const formatTag = document.createElement('span');
      formatTag.className = 'badge-tag';
      formatTag.textContent = imageData.format;
      formatTag.style.backgroundColor = '#9C27B0';
      formatTag.style.color = 'white';
      tagContainer.appendChild(formatTag);
    }
    
    card.appendChild(checkbox);
    card.appendChild(img);
    card.appendChild(previewBtn);
    card.appendChild(downloadBtn);
    card.appendChild(tagContainer);
    
    imageGrid.appendChild(card);
  });
  
  // 在所有图片卡片添加到DOM后更新下载按钮文本
  console.log('图片网格渲染完成，更新下载按钮文本');
  updateDownloadButtonText();
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
    
    // 显示下载状态
    const status = document.createElement('div');
    status.textContent = `正在下载 ${selectedUrls.length} 张图片...`;
    status.style.padding = '10px';
    status.style.backgroundColor = '#e6f7e6';
    status.style.borderRadius = '4px';
    status.style.marginTop = '10px';
    status.style.textAlign = 'center';
    
    const toolbar = document.querySelector('.toolbar');
    if (toolbar) {
      toolbar.after(status);
    }
    
    // 3秒后移除状态提示
    setTimeout(() => {
      status.remove();
    }, 3000);
  } else {
    alert('请先选择要下载的图片');
  }
}

// 选择/取消选择所有图片
function toggleSelectAll(selectAll = null) {
  const checkboxes = document.querySelectorAll('.card-checkbox');
  
  // 如果明确指定了selectAll参数，则使用它
  // 否则，根据当前是否有未选中的复选框来决定操作
  const setChecked = selectAll !== null ? 
    selectAll : 
    Array.from(checkboxes).some(checkbox => !checkbox.checked);
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = setChecked;
  });
  
  // 更新下载按钮文本
  updateDownloadButtonText();
}

// 取消选择所有图片
function deselectAll() {
  const checkboxes = document.querySelectorAll('.card-checkbox');
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
  });
  
  // 更新下载按钮文本
  updateDownloadButtonText();
}

// 预览图片
function previewImage(url) {
  const modal = document.getElementById('imageModal');
  if (!modal) return;
  
  const modalImg = document.getElementById('modalImage');
  if (!modalImg) return;
  
  // 保存当前预览的图片URL供下载按钮使用
  modal.dataset.currentImageUrl = url;
  
  modalImg.src = url;
  modal.classList.add('active');
  
  // 设置下载按钮事件
  const downloadBtn = document.getElementById('modalDownloadBtn');
  if (downloadBtn) {
    downloadBtn.onclick = function() {
      downloadSingleImage(url);
    };
  }
  
  // 设置关闭按钮事件
  const closeBtn = document.getElementById('modalCloseBtn');
  if (closeBtn) {
    closeBtn.onclick = closeImageModal;
  }
  
  // 点击模态框背景关闭
  modal.onclick = function(event) {
    if (event.target === modal) {
      closeImageModal();
    }
  };
  
  // 添加ESC键关闭
  document.addEventListener('keydown', handleEscKeydown);
}

// 关闭图片预览
function closeImageModal() {
  const modal = document.getElementById('imageModal');
  if (modal) {
    modal.classList.remove('active');
    
    // 移除ESC键事件监听
    document.removeEventListener('keydown', handleEscKeydown);
  }
}

// 处理ESC键按下事件
function handleEscKeydown(event) {
  if (event.key === 'Escape') {
    closeImageModal();
  }
}

// 初始化加载图片
async function fetchAndProcessImages() {
  const imageGrid = document.getElementById('imageGrid');
  if (!imageGrid) return;
  
  imageGrid.innerHTML = '';
  
  // 显示加载指示器
  const statusEl = document.querySelector('.status');
  if (statusEl) {
    statusEl.textContent = '正在获取图片...';
  }
  imageGrid.innerHTML = '<div style="text-align: center; padding: 20px;">正在加载图片...</div>';
  
  try {
    // 获取所有图片URL
    const tabImages = await getCurrentTabImages();
    const allImages = await getAllImages();
    const uniqueImageUrls = [...new Set([...tabImages, ...allImages])];
    
    console.log('找到图片URL:', uniqueImageUrls.length);
    
    if (uniqueImageUrls.length === 0) {
      if (statusEl) {
        statusEl.textContent = '未找到图片';
      }
      imageGrid.innerHTML = '<div style="text-align: center; padding: 20px;">未找到图片</div>';
      return;
    }
    
    // 获取所有图片的尺寸信息
    allImageData = []; // 清空旧数据
    
    // 加载中提示更新
    imageGrid.innerHTML = '<div style="text-align: center; padding: 20px;">正在分析图片尺寸 (0/' + uniqueImageUrls.length + ')...</div>';
    
    // 分批处理图片，避免一次性加载过多
    const batchSize = 5;
    let loadedCount = 0;
    
    for (let i = 0; i < uniqueImageUrls.length; i += batchSize) {
      const batch = uniqueImageUrls.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(url => getImageDimensions(url)));
      
      allImageData.push(...batchResults);
      loadedCount += batchResults.length;
      
      // 更新加载提示
      if (i + batchSize < uniqueImageUrls.length) {
        imageGrid.innerHTML = '<div style="text-align: center; padding: 20px;">正在分析图片尺寸 (' + 
          loadedCount + '/' + uniqueImageUrls.length + ')...</div>';
      }
    }
    
    console.log('图片分析完成:', allImageData.length);
    
    // 更新状态信息
    if (statusEl) {
      statusEl.textContent = `已找到 ${allImageData.length} 张图片`;
    }
    
    // 更新计数器
    const imageCountEl = document.getElementById('imageCount');
    if (imageCountEl) {
      imageCountEl.textContent = allImageData.length;
    }
    
    // 应用排序和过滤
    applyFiltersAndSort();
    
  } catch (error) {
    console.error('更新图片网格时出错:', error);
    if (statusEl) {
      statusEl.textContent = '获取图片时出错: ' + error.message;
    }
    imageGrid.innerHTML = '<div style="text-align: center; padding: 20px; color: red;">加载图片失败，请刷新页面</div>';
  }
}

// 根据URL检测图片格式
function detectImageFormat(url) {
  // 如果是Data URL
  if (url.startsWith('data:')) {
    const matches = url.match(/^data:image\/([a-zA-Z0-9]+);base64,/);
    if (matches && matches[1]) {
      return matches[1].toUpperCase();
    }
    return 'unknown';
  }
  
  // 检查是否是SVG内部引用或片段
  if (url.startsWith('#') || url === '%23linearGradient-1') {
    return 'SVG_FRAGMENT';
  }
  
  try {
    // 处理URL之前检查它是否是有效的URL
    // 有些URL可能是相对路径或不完整的URL
    let fullUrl = url;
    if (!url.match(/^(https?:\/\/|file:\/\/|data:)/i)) {
      // 如果它不是完整的URL，尝试将其视为相对于当前页面的URL
      try {
        const baseUrl = window.location.href.split('#')[0];
        fullUrl = new URL(url, baseUrl).href;
      } catch (e) {
        console.warn('无法形成有效URL:', url, e);
        return 'unknown';
      }
    }
    
    // 尝试创建URL对象以验证URL是否有效
    const urlObj = new URL(fullUrl);
    
    // 获取文件扩展名
    const pathname = urlObj.pathname;
    const extension = pathname.split('.').pop().toLowerCase();
    
    // 常见图片扩展名映射到格式
    const formatMap = {
      'jpg': 'JPEG',
      'jpeg': 'JPEG',
      'png': 'PNG',
      'gif': 'GIF',
      'webp': 'WEBP',
      'svg': 'SVG',
      'bmp': 'BMP',
      'ico': 'ICO'
    };
    
    return formatMap[extension] || 'unknown';
  } catch (e) {
    console.warn('无效的URL格式:', url, e);
    return 'unknown';
  }
}

// 加载图片获取尺寸
function loadImageAndGetDimensions(url, format, resolve) {
  const img = new Image();
  img.onload = () => {
    resolve({
      url: url,
      width: img.naturalWidth,
      height: img.naturalHeight,
      ratio: img.naturalWidth / img.naturalHeight,
      format: format,
      loaded: true
    });
  };
  img.onerror = () => {
    resolve({
      url: url,
      width: 0,
      height: 0,
      ratio: 1,
      format: 'unknown',
      loaded: false
    });
  };
  img.src = url;
}

// 获取图片的尺寸信息和格式
function getImageDimensions(url) {
  return new Promise((resolve) => {
    // 首先尝试通过URL判断格式
    let format = detectImageFormat(url);
    
    // 如果是SVG片段，直接跳过
    if (format === 'SVG_FRAGMENT') {
      resolve({
        url: url,
        width: 0,
        height: 0,
        loaded: false,
        format: 'SVG_FRAGMENT'
      });
      return;
    }
    
    // 如果通过URL无法确定格式，尝试通过发送请求判断
    if (format === 'unknown') {
      try {
        // 创建HEAD请求获取Content-Type
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', url, true);
        xhr.onreadystatechange = function() {
          if (xhr.readyState === 4) {
            if (xhr.status === 200) {
              const contentType = xhr.getResponseHeader('Content-Type');
              if (contentType) {
                if (contentType.includes('image/jpeg')) {
                  format = 'JPEG';
                } else if (contentType.includes('image/png')) {
                  format = 'PNG';
                } else if (contentType.includes('image/gif')) {
                  format = 'GIF';
                } else if (contentType.includes('image/webp')) {
                  format = 'WEBP';
                } else if (contentType.includes('image/svg+xml')) {
                  format = 'SVG';
                } else if (contentType.includes('image/')) {
                  format = contentType.split('/')[1].toUpperCase();
                }
              }
            }
            
            // 无论头部请求成功与否，继续加载图片获取尺寸
            loadImageAndGetDimensions(url, format, resolve);
          }
        };
        xhr.send(null);
      } catch (e) {
        console.error("Error checking format via HEAD request:", e);
        loadImageAndGetDimensions(url, format, resolve);
      }
    } else {
      // 如果已经通过URL确定了格式，直接加载图片获取尺寸
      loadImageAndGetDimensions(url, format, resolve);
    }
  });
}

// 生成尺寸类型标签
function getDimensionTags(imageData) {
  // 尺寸标签: 小/中/大图
  let sizeTag;
  let sizeTagColor;
  const area = imageData.width * imageData.height;
  
  if (area > 1200 * 1200) {
    sizeTag = '大图';
    sizeTagColor = 'rgba(76, 175, 80, 0.8)'; // 绿色
  } else if (area > 800 * 800) {
    sizeTag = '中图';
    sizeTagColor = 'rgba(33, 150, 243, 0.8)'; // 蓝色
  } else {
    sizeTag = '小图';
    sizeTagColor = 'rgba(158, 158, 158, 0.8)'; // 灰色
  }
  
  // 比例标签: 纵向/正方形/横向
  let ratioTag;
  let ratioTagColor;
  const ratio = imageData.width / imageData.height;
  
  if (ratio < 0.9) {
    ratioTag = '纵向';
    ratioTagColor = 'rgba(233, 30, 99, 0.8)'; // 粉色
  } else if (ratio > 1.1) {
    ratioTag = '横向';
    ratioTagColor = 'rgba(255, 152, 0, 0.8)'; // 橙色
  } else {
    ratioTag = '正方形';
    ratioTagColor = 'rgba(156, 39, 176, 0.8)'; // 紫色
  }
  
  // 尺寸标签: 宽x高
  const dimensionsTag = {
    text: `${imageData.width}×${imageData.height}`,
    color: 'rgba(97, 97, 97, 0.8)' // 深灰色
  };
  
  return [
    { text: sizeTag, color: sizeTagColor },
    { text: ratioTag, color: ratioTagColor },
    { text: dimensionsTag.text, color: dimensionsTag.color }
  ];
}

// 应用所有过滤器并排序
function applyFiltersAndSort() {
  try {
    // 获取当前选择的过滤值
    const minSize = getSizeFilterValue();
    const ratio = getRatioFilterValues();
    
    if (!allImageData) {
      console.warn('图片数据未初始化');
      return;
    }
    
    // 应用过滤器
    const filteredImages = allImageData.filter(img => {
      if (!img || !img.loaded) return false;
      
      // 检查图片尺寸
      const imageSize = Math.min(img.width, img.height);
      if (minSize > 0 && imageSize < minSize) {
        return false;
      }
      
      // 检查图片比例
      const imageRatio = img.width / img.height;
      if (!(imageRatio >= ratio.min && imageRatio <= ratio.max)) {
        return false;
      }
      
      return true;
    });
    
    // 获取当前选择的排序类型
    const sortSelect = document.getElementById('sortSelect');
    let sortType = 'none';
    
    if (sortSelect) {
      sortType = sortSelect.value || 'none';
    }
    
    // 排序图片
    if (sortType !== 'none') {
      filteredImages.sort((a, b) => {
        if (!a || !b) return 0;
        return calculateSortValue(a, sortType) - calculateSortValue(b, sortType);
      });
    }
    
    // 更新图片网格
    displayImages(filteredImages);
  } catch (error) {
    console.error('应用过滤器错误:', error);
  }
}

// 向background脚本注册侧边栏
chrome.runtime.sendMessage({ type: 'REGISTER_SIDE_PANEL' });

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('Side panel initialized');
  
  // 获取按钮元素
  const refreshBtn = document.getElementById('refreshBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deselectAllBtn = document.getElementById('deselectAllBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const ratioSlider = document.getElementById('ratioSlider');
  const minSizeSlider = document.getElementById('minSizeSlider');
  const sortSelect = document.getElementById('sortSelect');
  
  // 添加事件监听器
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadSelectedImages);
  }

  // 刷新按钮事件
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      console.log('刷新图片');
      // 清空后台存储的图片
      chrome.runtime.sendMessage({ type: 'CLEAR_IMAGES' }, () => {
        // 重新扫描和加载图片
        fetchAndProcessImages();
      });
    });
  }

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      toggleSelectAll(true);
      updateDownloadButtonText();
    });
  }
  
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
      deselectAll();
      updateDownloadButtonText();
    });
  }
  
  // 监听图片网格中的复选框变化
  document.addEventListener('change', (event) => {
    if (event.target.classList.contains('card-checkbox')) {
      console.log('捕获到复选框change事件通过事件委托');
      updateDownloadButtonText();
    }
  });
  
  // 初始化滑块标签
  updateSliderLabels();
  
  // 滑块事件
  if (minSizeSlider) {
    minSizeSlider.addEventListener('input', updateSizeFilter);
  }
  
  if (ratioSlider) {
    ratioSlider.addEventListener('input', updateSliderLabels);
  }
  
  // 初始化下载按钮文本
  console.log('初始化下载按钮文本');
  updateDownloadButtonText();
  
  // 排序选择变更事件
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      applyFiltersAndSort();
    });
  }
  
  // 模态框关闭按钮事件
  const closeBtn = document.querySelector('.close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const imageModal = document.getElementById('imageModal');
      if (imageModal) {
        imageModal.classList.remove('active');
      }
    });
  }
  
  // 为ESC按键添加关闭模态框的事件监听
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const imageModal = document.getElementById('imageModal');
      if (imageModal) {
        imageModal.classList.remove('active');
      }
    }
  });
  
  // 初始化加载图片
  fetchAndProcessImages();
  
  // 监听标签页更新，自动刷新图片
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
      console.log('Tab updated, refreshing images');
      setTimeout(fetchAndProcessImages, 1000); // 等待一秒，让页面完全加载
    }
  });
});

// 更新下载按钮文本，显示选中的图片数量
function updateDownloadButtonText() {
  const downloadBtn = document.getElementById('downloadBtn');
  if (!downloadBtn) {
    console.warn('无法找到下载按钮元素');
    return;
  }
  
  const checkboxes = document.querySelectorAll('.card-checkbox:checked');
  const selectedCount = checkboxes.length;
  
  console.log('更新下载按钮文本，选中数量:', selectedCount);
  
  if (selectedCount === 0) {
    downloadBtn.textContent = '下载选中';
  } else {
    downloadBtn.textContent = `下载选中 (${selectedCount})`;
  }
}
