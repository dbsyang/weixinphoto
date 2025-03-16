// 存储所有图片数据
let allImageData = [];
let isProcessing = false; // 添加处理状态标志
let processingTimeout = null; // 用于防抖的timeout

// 防抖函数
function debounce(func, wait) {
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(processingTimeout);
      func(...args);
    };
    clearTimeout(processingTimeout);
    processingTimeout = setTimeout(later, wait);
  };
}

// 初始化加载图片
async function fetchAndProcessImages() {
  // 如果正在处理中，直接返回
  if (isProcessing) {
    console.log('图片正在处理中，跳过重复请求');
    return;
  }
  
  const imageGrid = document.getElementById('imageGrid');
  if (!imageGrid) return;
  
  isProcessing = true; // 设置处理标志
  
  try {
    imageGrid.innerHTML = '';
    
    // 显示加载指示器
    const statusEl = document.querySelector('.status');
    if (statusEl) {
      statusEl.textContent = '正在获取图片...';
    }
    imageGrid.innerHTML = '<div style="text-align: center; padding: 20px;">正在加载图片...</div>';
    
    // 先清空后台存储的图片
    await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'CLEAR_IMAGES' }, () => {
        console.log('已清空后台图片缓存');
        resolve();
      });
    });

    // 只从当前页面获取图片
    const tabImages = await getCurrentTabImages();
    
    // 使用规范化的URL进行去重，并保留最高质量的格式
    const normalizedUrls = new Map(); // 使用Map存储baseUrl到最佳URL的映射
    
    // 处理并记录所有图片URL
    console.log('开始处理图片URL...');
    tabImages.forEach(url => {
      if (!url || typeof url !== 'string') return; // 跳过无效URL
      
      // 只处理微信图片
      if (!url.includes('mmbiz.qpic.cn') && !url.includes('mmsns.qpic.cn')) return;
      
      const normalized = normalizeWechatImageUrl(url);
      if (!normalized.baseUrl) return; // 跳过无效的规范化结果
      
      const existing = normalizedUrls.get(normalized.baseUrl);
      
      // 如果这个baseUrl还没有对应的URL，或者当前URL的格式优先级更高
      if (!existing || normalized.priority > existing.priority) {
        console.log(`处理图片URL: ${url} -> 基础URL: ${normalized.baseUrl}, 格式: ${normalized.format}, 优先级: ${normalized.priority}`);
        normalizedUrls.set(normalized.baseUrl, normalized);
      }
    });
    
    // 使用最佳格式的原始URL
    const uniqueImageUrls = Array.from(normalizedUrls.values())
      .filter(item => item && item.originalUrl) // 确保所有项都有效
      .map(item => item.originalUrl);
    
    console.log('找到唯一图片URL:', uniqueImageUrls.length);
    
    if (uniqueImageUrls.length === 0) {
      if (statusEl) {
        statusEl.textContent = '未找到图片';
      }
      imageGrid.innerHTML = '<div style="text-align: center; padding: 20px;">未找到图片</div>';
      return;
    }
    
    // 获取所有图片的尺寸信息
    allImageData = []; // 清空旧数据
    let validImageCount = 0; // 跟踪有效图片数量
        
    // 分批处理图片，避免一次性加载过多
    const batchSize = 5;
    let processedCount = 0;
    
    for (let i = 0; i < uniqueImageUrls.length; i += batchSize) {
      const batch = uniqueImageUrls.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(url => getImageDimensions(url)));
      
      // 过滤掉无效的结果（null或未加载成功的）
      const validResults = batchResults.filter(result => result !== null);
      allImageData.push(...validResults);
      validImageCount = allImageData.length; // 使用实际的数组长度
      processedCount += batch.length;
      
      // 更新加载提示
      if (statusEl) {
        statusEl.textContent = `正在分析图片 (${processedCount}/${uniqueImageUrls.length})`;
      }
    }
    
    console.log('图片分析完成，有效图片数量:', validImageCount);
    
    // 更新状态信息
    if (statusEl) {
      statusEl.textContent = `已找到 ${validImageCount} 张有效图片`;
    }
    
    // 更新计数器
    const imageCountEl = document.getElementById('imageCount');
    if (imageCountEl) {
      imageCountEl.textContent = validImageCount;
    }
    
    // 应用排序和过滤
    applyFiltersAndSort();
    
  } catch (error) {
    console.error('更新图片网格时出错:', error);
    if (statusEl) {
      statusEl.textContent = '获取图片时出错: ' + error.message;
    }
    imageGrid.innerHTML = '<div style="text-align: center; padding: 20px; color: red;">加载图片失败，请刷新页面</div>';
  } finally {
    isProcessing = false; // 重置处理标志
  }
}

// 创建防抖版本的fetchAndProcessImages
const debouncedFetchAndProcessImages = debounce(fetchAndProcessImages, 1000);

// 监听标签页切换事件
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log('标签页切换，新的活动标签页ID:', activeInfo.tabId);
  debouncedFetchAndProcessImages();
});

// 监听标签页更新事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    console.log('当前标签页已完成加载:', tab.url);
    debouncedFetchAndProcessImages();
  }
});

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
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      console.warn('没有找到活动标签页');
      return [];
    }
    
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_IMAGES' }, (images) => {
        if (chrome.runtime.lastError) {
          console.log('获取图片过程中发生错误 (可忽略):', chrome.runtime.lastError.message);
          resolve([]);
        } else {
          resolve(images || []);
        }
      });
    });
  } catch (error) {
    console.error('获取标签页图片错误:', error);
    return [];
  }
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
  // 处理微信图片URL
  const isWechatImage = url.includes('mmbiz.qpic.cn') || url.includes('mmsns.qpic.cn');
  
  const img = new Image();
  let timeoutId;
  
  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    img.onload = null;
    img.onerror = null;
  };
  
  img.onload = () => {
    cleanup();
    // 确保图片实际加载成功且有有效尺寸
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      resolve({
        url: url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        ratio: img.naturalWidth / img.naturalHeight,
        format: format,
        loaded: true,
        isWechat: isWechatImage
      });
    } else {
      resolve(null); // 返回null表示无效图片
    }
  };
  
  img.onerror = () => {
    cleanup();
    resolve(null); // 返回null表示加载失败
  };
  
  // 设置3秒超时
  timeoutId = setTimeout(() => {
    cleanup();
    resolve(null); // 超时返回null
  }, 3000);
  
  // 直接使用原始URL，不添加时间戳
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
    minWidth = parseInt(minSizeSlider.value || 0);
  }
  
  if (maxSizeSlider) {
    maxWidth = parseInt(maxSizeSlider.value || 10000);
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
  
  // 在所有图片卡片添加到DOM后更新下载按钮文本和选中计数
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
function toggleSelectAll() {
  const checkboxes = document.querySelectorAll('.card-checkbox');
  const selectAllBtn = document.getElementById('selectAllBtn');
  
  // 检查当前是否所有图片都被选中
  const allSelected = Array.from(checkboxes).every(checkbox => checkbox.checked);
  
  // 根据当前状态切换选择
  checkboxes.forEach(checkbox => {
    checkbox.checked = !allSelected;
  });
  
  // 更新按钮文本
  selectAllBtn.textContent = allSelected ? '全选' : '取消全选';
  
  // 更新下载按钮状态
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

// 规范化微信图片URL，去除尺寸参数等
function normalizeWechatImageUrl(url) {
  try {
    if (!url) return '';
    
    // 处理微信图片URL
    if (url.includes('mmbiz.qpic.cn') || url.includes('mmsns.qpic.cn')) {
      // 提取基础URL（移除所有参数）
      let baseUrl = url.split('?')[0];
      
      // 提取wx_fmt参数（如果存在）
      const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '');
      const format = params.get('wx_fmt');
      
      // 清理URL中的数字参数（通常是尺寸相关）
      baseUrl = baseUrl.replace(/\d+$/, '');
      
      return {
        baseUrl,
        format,
        originalUrl: url,
        priority: getFormatPriority(url)
      };
    }
    return {
      baseUrl: url,
      format: null,
      originalUrl: url,
      priority: 0
    };
  } catch (error) {
    console.error('规范化URL出错:', error);
    return {
      baseUrl: url,
      format: null,
      originalUrl: url,
      priority: 0
    };
  }
}

// 获取图片格式的优先级分数
function getFormatPriority(url) {
  // 从URL中提取wx_fmt参数
  const match = url.match(/wx_fmt=([^&]+)/);
  const format = match ? match[1].toLowerCase() : '';
  
  // 格式优先级（分数越高越优先）
  const priorities = {
    'png': 100,    // 无损格式，通常质量最好
    'webp': 90,    // 新一代格式，压缩效果好
    'jpeg': 80,    // 标准格式
    'jpg': 80,     // 等同于jpeg
    'gif': 70      // 动图格式
  };
  
  return priorities[format] || 0;
}

// 向background脚本注册侧边栏
chrome.runtime.sendMessage({ type: 'REGISTER_SIDE_PANEL' });

// 监听标签页切换事件
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log('标签页切换，新的活动标签页ID:', activeInfo.tabId);
  // 当标签页切换时，自动刷新侧边栏内容
  setTimeout(() => {
    fetchAndProcessImages();
  }, 500); // 延迟500ms，确保内容脚本已加载
});

// 监听标签页更新事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    console.log('当前标签页已完成加载:', tab.url);
    // 当标签页加载完成时，自动刷新侧边栏内容
    setTimeout(() => {
      fetchAndProcessImages();
    }, 500); // 延迟500ms，确保内容脚本已加载
  }
});

// 初始化UI元素和事件监听
function initializeUI() {
  console.log('初始化UI元素和事件监听器');
  
  // 获取按钮元素
  const refreshBtn = document.getElementById('refreshBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const ratioSlider = document.getElementById('ratioSlider');
  const minSizeSlider = document.getElementById('minSizeSlider');
  
  // 添加事件监听器
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadSelectedImages);
  }

  // 全选/取消全选按钮事件
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', toggleSelectAll);
  }
  
  // 刷新按钮事件
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      console.log('刷新图片');
      
      // 显示加载中状态
      const imageGrid = document.getElementById('imageGrid');
      const statusEl = document.querySelector('.status');
      if (statusEl) {
        statusEl.textContent = '正在刷新图片...';
      }
      if (imageGrid) {
        imageGrid.innerHTML = '<div style="text-align: center; padding: 20px;">正在刷新图片...</div>';
      }
      
      // 清空后台存储的图片
      await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'CLEAR_IMAGES' }, () => {
          console.log('已清空后台图片缓存');
          resolve();
        });
      });
      
      // 触发当前标签页重新扫描图片
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          console.log('尝试与标签页通信，标签页ID:', tab.id, '，URL:', tab.url);
          
          // 检查内容脚本是否已注入
          try {
            // 先尝试发送一个简单的ping消息检查内容脚本是否已注入
            await new Promise((resolve, reject) => {
              chrome.tabs.sendMessage(tab.id, { type: 'PING' }, response => {
                if (chrome.runtime.lastError) {
                  console.log('内容脚本未注入或无法通信:', chrome.runtime.lastError.message);
                  // 尝试注入内容脚本
                  chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                  }).then(() => {
                    console.log('内容脚本已注入');
                    resolve();
                  }).catch(err => {
                    console.error('注入内容脚本失败:', err);
                    resolve(); // 即使失败也继续
                  });
                } else {
                  console.log('内容脚本已存在，继续扫描');
                  resolve();
                }
              });
            });
            
            // 发送扫描命令
            await new Promise(resolve => {
              chrome.tabs.sendMessage(tab.id, { type: 'SCAN_IMAGES' }, (response) => {
                if (chrome.runtime.lastError) {
                  console.log('触发扫描图片时出错 (可忽略):', chrome.runtime.lastError.message);
                } else {
                  console.log('页面重新扫描图片完成:', response);
                }
                resolve();
              });
            });
          } catch (err) {
            console.error('与内容脚本通信出错:', err);
          }
        } else {
          console.warn('未找到活动标签页');
        }
      } catch (error) {
        console.error('触发页面扫描图片时出错:', error);
      }
      
      // 重新获取和处理图片
      await fetchAndProcessImages();
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
  
  // 排序按钮和下拉菜单事件
  const sortBtn = document.getElementById('sortBtn');
  const sortDropdown = document.querySelector('.sort-dropdown');
  const sortItems = document.querySelectorAll('.sort-item');
  
  if (sortBtn && sortDropdown) {
    // 默认初始化按钮属性为面积从大到小
    sortBtn.setAttribute('data-sort', 'area-desc');
    document.getElementById('currentSortText').textContent = '面积从大到小';
    
    // 鼠标悬停显示下拉菜单
    sortDropdown.addEventListener('mouseenter', () => {
      document.querySelector('.sort-dropdown-content').classList.add('show');
    });
    
    // 鼠标离开隐藏下拉菜单
    sortDropdown.addEventListener('mouseleave', () => {
      document.querySelector('.sort-dropdown-content').classList.remove('show');
    });
    
    // 为每个排序选项添加点击事件
    sortItems.forEach(item => {
      item.addEventListener('click', () => {
        const value = item.getAttribute('data-value');
        const text = item.textContent;
        
        // 更新按钮文本和数据属性
        document.getElementById('currentSortText').textContent = text;
        sortBtn.setAttribute('data-sort', value);
        
        // 应用排序
        applyFiltersAndSort();
        
        // 隐藏下拉菜单
        document.querySelector('.sort-dropdown-content').classList.remove('show');
      });
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
}

// 当DOM加载完成时初始化UI
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM加载完成，开始初始化UI');
  initializeUI();
});

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
  // 处理微信图片URL
  const isWechatImage = url.includes('mmbiz.qpic.cn') || url.includes('mmsns.qpic.cn');
  
  const img = new Image();
  let timeoutId;
  
  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    img.onload = null;
    img.onerror = null;
  };
  
  img.onload = () => {
    cleanup();
    // 确保图片实际加载成功且有有效尺寸
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      resolve({
        url: url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        ratio: img.naturalWidth / img.naturalHeight,
        format: format,
        loaded: true,
        isWechat: isWechatImage
      });
    } else {
      resolve(null); // 返回null表示无效图片
    }
  };
  
  img.onerror = () => {
    cleanup();
    resolve(null); // 返回null表示加载失败
  };
  
  // 设置3秒超时
  timeoutId = setTimeout(() => {
    cleanup();
    resolve(null); // 超时返回null
  }, 3000);
  
  // 直接使用原始URL，不添加时间戳
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
    
    // 检查是否应用了过滤条件
    const totalImages = allImageData.filter(img => img && img.loaded).length;
    const isFiltered = filteredImages.length < totalImages;
    console.log('过滤条件状态:', isFiltered ? '已应用过滤' : '无过滤', 
                '总图片:', totalImages, 
                '过滤后:', filteredImages.length);
    
    // 获取当前选择的排序类型
    let sortType = document.getElementById('sortBtn')?.getAttribute('data-sort') || 'none';
    
    // 排序图片
    if (sortType !== 'none') {
      filteredImages.sort((a, b) => {
        if (!a || !b) return 0;
        return calculateSortValue(a, sortType) - calculateSortValue(b, sortType);
      });
    }
    
    // 更新过滤状态显示
    const filteredStatusEl = document.querySelector('.filtered-status');
    const filteredCountEl = document.getElementById('filteredCount');
    
    if (isFiltered && filteredStatusEl && filteredCountEl) {
      filteredStatusEl.style.display = 'inline';
      filteredCountEl.textContent = filteredImages.length;
    } else if (filteredStatusEl) {
      filteredStatusEl.style.display = 'none';
    }
    
    // 更新状态显示
    const statusEl = document.querySelector('.status');
    if (statusEl) {
      statusEl.textContent = `已发现 ${filteredImages.length}/${totalImages} 张图片`;
    }

    // 更新图片网格
    displayImages(filteredImages);
  } catch (error) {
    console.error('应用过滤器错误:', error);
  }
}

// 向background脚本注册侧边栏
chrome.runtime.sendMessage({ type: 'REGISTER_SIDE_PANEL' });

// 监听标签页切换事件
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log('标签页切换，新的活动标签页ID:', activeInfo.tabId);
  // 当标签页切换时，自动刷新侧边栏内容
  setTimeout(() => {
    fetchAndProcessImages();
  }, 500); // 延迟500ms，确保内容脚本已加载
});

// 监听标签页更新事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    console.log('当前标签页已完成加载:', tab.url);
    // 当标签页加载完成时，自动刷新侧边栏内容
    setTimeout(() => {
      fetchAndProcessImages();
    }, 500); // 延迟500ms，确保内容脚本已加载
  }
});

// 刷新按钮事件
document.addEventListener('DOMContentLoaded', () => {
  console.log('Side panel initialized');
  
  // 获取按钮元素
  const refreshBtn = document.getElementById('refreshBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const ratioSlider = document.getElementById('ratioSlider');
  const minSizeSlider = document.getElementById('minSizeSlider');
  
  // 添加事件监听器
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadSelectedImages);
  }

  // 全选/取消全选按钮事件
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', toggleSelectAll);
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
  
  // 排序按钮和下拉菜单事件
  const sortBtn = document.getElementById('sortBtn');
  const sortDropdown = document.querySelector('.sort-dropdown');
  const sortItems = document.querySelectorAll('.sort-item');
  
  if (sortBtn && sortDropdown) {
    // 默认初始化按钮属性为面积从大到小
    sortBtn.setAttribute('data-sort', 'area-desc');
    document.getElementById('currentSortText').textContent = '面积从大到小';
    
    // 鼠标悬停显示下拉菜单
    sortDropdown.addEventListener('mouseenter', () => {
      document.querySelector('.sort-dropdown-content').classList.add('show');
    });
    
    // 鼠标离开隐藏下拉菜单
    sortDropdown.addEventListener('mouseleave', () => {
      document.querySelector('.sort-dropdown-content').classList.remove('show');
    });
    
    // 为每个排序选项添加点击事件
    sortItems.forEach(item => {
      item.addEventListener('click', () => {
        const value = item.getAttribute('data-value');
        const text = item.textContent;
        
        // 更新按钮文本和数据属性
        document.getElementById('currentSortText').textContent = text;
        sortBtn.setAttribute('data-sort', value);
        
        // 应用排序
        applyFiltersAndSort();
        
        // 隐藏下拉菜单
        document.querySelector('.sort-dropdown-content').classList.remove('show');
      });
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
  const checkboxes = document.querySelectorAll('.card-checkbox:checked');
  
  if (downloadBtn) {
    downloadBtn.textContent = `下载选中图片 (${checkboxes.length})`;
    downloadBtn.disabled = checkboxes.length === 0;
  }
}
