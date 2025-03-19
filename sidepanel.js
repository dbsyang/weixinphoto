// 存储所有图片数据
let allImageData = [];
let isProcessing = false; // 添加处理状态标志
let processingTimeout = null; // 用于防抖的timeout

// 防抖函数的效果是：在指定时间内，只执行最后一次调用。
// function debounce(func, wait) {
//   return function executedFunction(...args) {
//     const later = () => {
//       clearTimeout(processingTimeout);
//       func(...args);
//     };
//     clearTimeout(processingTimeout);
//     processingTimeout = setTimeout(later, wait);
//   };
// }

// 初始化加载图片
async function fetchAndProcessImages() {
  // 如果正在处理中，直接返回
  if (isProcessing) {
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
    // imageGrid.innerHTML = '<div style="text-align: center; padding: 20px;">正在加载图片...</div>';
    
    // 先清空后台存储的图片
    await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'CLEAR_IMAGES' }, () => {
        resolve();
      });
    });

    // 只从当前页面获取图片
    const tabImages = await getCurrentTabImages();
    console.log('Fetched images from current tab:', tabImages);
    
    // 使用规范化的URL进行去重，并保留最高质量的格式
    const normalizedUrls = new Map(); // 使用Map存储baseUrl到最佳URL的映射
    
    // 处理并记录所有图片URL
    tabImages.forEach(url => {
      if (!url || typeof url !== 'string') return; // 跳过无效URL
      
      // 只处理微信图片
      // if (!url.includes('mmbiz.qpic.cn') && !url.includes('mmsns.qpic.cn')) return;
      
      const normalized = normalizeWechatImageUrl(url);
      if (!normalized.baseUrl) return; // 跳过无效的规范化结果
      
      const existing = normalizedUrls.get(normalized.baseUrl);
      
      // 如果这个baseUrl还没有对应的URL，或者当前URL的格式优先级更高
      if (!existing || normalized.priority > existing.priority) {
        normalizedUrls.set(normalized.baseUrl, normalized);
      }
    });
    
    // 使用最佳格式的原始URL
    const uniqueImageUrls = Array.from(normalizedUrls.values())
      .filter(item => item && item.originalUrl) // 确保所有项都有效
      .map(item => item.originalUrl);
    
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
    
    // 更新状态信息
    if (statusEl) {
      statusEl.textContent = `已找到 ${validImageCount} 张有效图片`;
    }
    
    // 更新计数器
    const imageCountEl = document.getElementById('imageCount');
    if (imageCountEl) {
      imageCountEl.textContent = validImageCount;
    }
    
    // 应用过滤器
    applyFiltersAndSort();
    
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = '获取图片时出错: ' + error.message;
    }
    // imageGrid.innerHTML = '<div style="text-align: center; padding: 20px; color: red;">加载图片失败，请刷新页面</div>';
  } finally {
    isProcessing = false; // 重置处理标志
  }
}

// 创建防抖版本的fetchAndProcessImages
// const debouncedFetchAndProcessImages = debounce(fetchAndProcessImages, 1000);

// 监听标签页切换事件
chrome.tabs.onActivated.addListener((activeInfo) => {
  fetchAndProcessImages();
});

// 监听标签页更新事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    fetchAndProcessImages();
  }
});

// 获取当前标签页中的图片
async function getCurrentTabImages() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      return [];
    }
    
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_IMAGES' }, (images) => {
        if (chrome.runtime.lastError) {
          resolve([]);
        } else {
          resolve(images || []);
        }
      });
    });
  } catch (error) {
    return [];
  }
}

// 应用所有过滤器并排序
function applyFiltersAndSort() {
  try {
    // 直接使用所有图片数据
    const filteredImages = allImageData.filter(img => img && img.loaded);
    
    // 更新图片网格
    updateImageGrid(filteredImages);
  } catch (error) {
  }
}

// 根据当前过滤器和排序条件更新图片网格
function updateImageGrid(images) {
  // 获取过滤器元素
  const imageGrid = document.getElementById('imageGrid');
  
  // 清空旧的图片网格
  imageGrid.innerHTML = '';
  
  if (images.length === 0) {
    imageGrid.innerHTML = '<div style="text-align: center; padding: 20px;">没有符合条件的图片</div>';
    return;
  }
  
  // 创建图片卡片
  images.forEach((imageData) => {
    const card = document.createElement('div');
    card.className = 'card';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'card-checkbox';
    checkbox.dataset.url = imageData.url;
    checkbox.addEventListener('change', () => {
      updateDownloadButtonText();
    });
    
    const img = document.createElement('img');
    img.src = imageData.url;
    img.loading = 'lazy';
    img.style.cursor = 'pointer';
    
    // 创建下载按钮
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'card-download-btn';
    downloadBtn.textContent = '下载';
    downloadBtn.onclick = () => downloadSingleImage(imageData.url);
    
    // 创建标签容器
    const tagContainer = document.createElement('div');
    tagContainer.className = 'tag-container';
    
    // 生成标签
    const tags = createTags(imageData);
    
    // 添加尺寸标签到容器中
    tags.forEach((tag) => {
      const tagElement = document.createElement('span');
      tagElement.className = 'badge-tag';
      tagElement.textContent = tag.text;
      tagElement.style.backgroundColor = tag.color;
      tagElement.style.color = 'white';
      tagContainer.appendChild(tagElement);
    });
    
    card.appendChild(checkbox);
    card.appendChild(img);
    card.appendChild(downloadBtn);
    card.appendChild(tagContainer);
    
    imageGrid.appendChild(card);
  });
  
  // 在所有图片卡片添加到DOM后更新下载按钮文本和选中计数
  updateDownloadButtonText();
}

// 下载单张图片
function downloadSingleImage(url) {
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

// 下载选中的图片
function downloadSelectedImages() {
  const selectedUrls = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
    .map(checkbox => checkbox.dataset.url);
  
  if (selectedUrls.length > 0) {
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
  setTimeout(() => {
    fetchAndProcessImages();
  }, 500); // 延迟500ms，确保内容脚本已加载
});

// 监听标签页更新事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    setTimeout(() => {
      fetchAndProcessImages();
    }, 500); // 延迟500ms，确保内容脚本已加载
  }
});

// 初始化UI元素和事件监听
function initializeUI() {
  // 获取按钮元素
  const refreshBtn = document.getElementById('refreshBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  
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
      // 显示加载中状态
      const imageGrid = document.getElementById('imageGrid');
      const statusEl = document.querySelector('.status');
      if (statusEl) {
        statusEl.textContent = '正在刷新图片...';
      }
      if (imageGrid) {
        imageGrid.innerHTML = '<div style="text-align: center; padding: 20px;">正在刷新图片...</div>';
      }
      
      // 清空后台存储的图片，这里会清理background.js中的imageUrls数组
      await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'CLEAR_IMAGES' }, () => {
          resolve();
        });
      });
      
      // 触发当前标签页重新扫描图片
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          // 检查内容脚本是否已注入
          try {
            // 先尝试发送一个简单的ping消息检查内容脚本是否已注入
            await new Promise((resolve, reject) => {
              chrome.tabs.sendMessage(tab.id, { type: 'PING' }, response => {
                if (chrome.runtime.lastError) {
                  // 尝试注入内容脚本
                  chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                  }).then(() => {
                    resolve();
                  }).catch(err => {
                    resolve(); // 即使失败也继续
                  });
                } else {
                  resolve();
                }
              });
            });
            
            // 发送扫描命令，这里会触发content.js中的scanImages函数
            await new Promise(resolve => {
              chrome.tabs.sendMessage(tab.id, { type: 'SCAN_IMAGES' }, (response) => {
                resolve();
              });
            });
          } catch (err) {
          }
        } else {
        }
      } catch (error) {
      }
      
      // 重新获取和处理图片
      await fetchAndProcessImages();
    });
  }
  
  // 监听图片网格中的复选框变化
  document.addEventListener('change', (event) => {
    if (event.target.classList.contains('card-checkbox')) {
      updateDownloadButtonText();
    }
  });
  
  // 初始化下载按钮文本
  updateDownloadButtonText();
  
  // 排序按钮和下拉菜单事件
  // const sortBtn = document.getElementById('sortBtn');
  // const sortDropdown = document.querySelector('.sort-dropdown');
  // const sortItems = document.querySelectorAll('.sort-item');
  
  // if (sortBtn && sortDropdown) {
  //   // 默认初始化按钮属性为面积从大到小
  //   sortBtn.setAttribute('data-sort', 'area-desc');
  //   document.getElementById('currentSortText').textContent = '面积从大到小';
    
  //   // 鼠标悬停显示下拉菜单
  //   sortDropdown.addEventListener('mouseenter', () => {
  //     document.querySelector('.sort-dropdown-content').classList.add('show');
  //   });
    
  //   // 鼠标离开隐藏下拉菜单
  //   sortDropdown.addEventListener('mouseleave', () => {
  //     document.querySelector('.sort-dropdown-content').classList.remove('show');
  //   });
    
  //   // 为每个排序选项添加点击事件
  //   sortItems.forEach(item => {
  //     item.addEventListener('click', () => {
  //       const value = item.getAttribute('data-value');
  //       const text = item.textContent;
        
  //       // 更新按钮文本和数据属性
  //       document.getElementById('currentSortText').textContent = text;
  //       sortBtn.setAttribute('data-sort', value);
        
  //       // 应用排序
  //       applyFiltersAndSort();
        
  //       // 隐藏下拉菜单
  //       document.querySelector('.sort-dropdown-content').classList.remove('show');
  //     });
  //   });
  // }
  
  // 初始化加载图片
  fetchAndProcessImages();
}

// 当DOM加载完成时初始化UI
document.addEventListener('DOMContentLoaded', () => {
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
    
    // 如果通过URL无法确定格式，直接加载图片获取尺寸
    loadImageAndGetDimensions(url, format, resolve);
  });
}

// 更新下载按钮文本，显示选中的图片数量
function updateDownloadButtonText() {
  const downloadBtn = document.getElementById('downloadBtn');
  const checkboxes = document.querySelectorAll('.card-checkbox:checked');
  
  if (downloadBtn) {
    downloadBtn.textContent = `下载选中图片 (${checkboxes.length})`;
    downloadBtn.disabled = checkboxes.length === 0;
  }
}

// 生成尺寸类型标签和格式标签
function createTags(imageData) {
  // 尺寸标签: 宽x高
  const dimensionsTag = {
    text: `${imageData.width}×${imageData.height}`,
    color: 'rgba(97, 97, 97, 0.8)' // 深灰色
  };
  
  // 格式标签
  const formatTag = {
    text: imageData.format,
    color: 'rgba(97, 97, 97, 0.8)' // 深灰色
  };
  
  return [
    { text: dimensionsTag.text, color: dimensionsTag.color },
    { text: formatTag.text, color: formatTag.color }
  ];
}
