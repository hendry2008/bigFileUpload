# 大文件断点续传

## 获取文件分片

浏览器环境 File 对象继承自 Blob。除了 Blob 方法和属性外，File 对象还有 name 和 lastModified 属性，
以及从文件系统读取的内部功能。我们通常从用户输入如 `<input>` 或拖放事件来获取 File 对象。

可以通过 Blob 对象的 slice 方法对文件进行分片, 返回的是 blob 对象

```js
function createChunkList(originFile, size = MAX_SIZE) {
  let _chunkList = []
  let currentSize = 0
  while (originFile.size > currentSize) {
    const _chunk = originFile.slice(currentSize, currentSize + size)
    _chunkList.push(_chunk)
    currentSize += _chunk.size
  }
  return _chunkList
}
```

## 浏览器端上传分片

封装分片为 dataForm 数据上传

```js
          const uploadRequests = chunkList
            .map((chunk, index) => {
              const formData = new FormData()
              formData.append('chunk', chunk)
              formData.append('index', index)
              formData.append('name', container.name)
              formData.append('hash', fileHash)
              return formData
            })
            .map(async (formData, index) => {
              // 先判断是否需要重新上传
              console.log(`checking should upload chunk ${index} ...`)
              const should = await shouldUpload(`${fileHash}-${index}`, fileHash, index)
              console.log(`chunk ${index} should:>> `, should)
              // 如果需要上传则request, 否则则认为这个切片已经上传, 直接更新进度条
              if (should) {
                return request({
                  url: UPLOAD_URL,
                  onProgress: createProgressCallback(index),
                  method: 'post',
                  data: formData,
                })
              } else {
                const totalPercent = updateTotalLoadedPercent(index, chunkList[index].size)
                // 设置这个分片为100完成, 并将这个分片大小算为完成, 计算总完成进度
                updateProgressBar(index, '100%', totalPercent)
              }
            })
          await Promise.all(uploadRequests)
        }
```

## 结合文件 hash 实现秒传

hash 的获取, 浏览器环境获取 hash , 如果直接用 md5 对文件 hash 会导致不同的文件 hash 出现重复的问题
使用 spark-md5 对分片数组进行 hash 据说则没有这个问题
另外把这个 hash 计算放在 worker 中避免对 ui 的阻塞
秒传功能实现是基于这个 hash 的 , 客户端真正上传之前需要去服务器端请求, 服务器端返回这个 chunk 是否已经存在
如果已经存在则无需上传, 本地直接设置该分片进度为 100% , 并把该分片大小算做已经上传,更新整体进度

### 浏览器端计算文件 hash

```js
self.importScripts('./spark-md5.min.js')

self.onmessage = (e) => {
  const chunkList = e.data
  console.log('worker hashing chunkList:', chunkList)
  if (chunkList.length < 1) return

  const fileReader = new FileReader()

  let currentChunkIndex = 0

  fileReader.readAsArrayBuffer(chunkList[currentChunkIndex])

  const spark = new SparkMD5.ArrayBuffer()

  fileReader.onload = function (e) {
    // 将读取到的chunk 内容计算hash
    spark.append(e.target.result)
    currentChunkIndex++
    // 如果还有chunk 则继续读
    if (currentChunkIndex <= chunkList.length - 1) {
      fileReader.readAsArrayBuffer(chunkList[currentChunkIndex])
    } else {
      // 如果没有, 则消息返回hash
      const hash = spark.end()
      self.postMessage(hash)
    }
  }
}
```

### 服务器端提供接口判断分片是否需要上传

服务器 node 端目录结构是一把个大文件相关的切片都放在同一个目录下, 目录名就是文件 hash
浏览器上传的时候带上 hash
在 chunk 上传到服务器端的时候, 需要把本次相关的文件都放到一个 hash 目录下, 根据 index 进行命名
下次上传的时候, 服务器端需要检查 hash , 检查目录来判断 chunk 是否存在, 提供这样的接口给前端
前端访问接口判断是否需要上传, 从而实现秒传

// 服务器端接口, 检查返回是否存在切片, 存在的无需上传

```js
if (method === 'post' && urlPath === '/should-upload') {
  // console.log('req :>> ', req.read)
  function parseParams() {
    return new Promise((resolve) => {
      let _dataString = ''
      req.on('data', (data) => {
        // console.log('needUpload req data: ', data)
        _dataString += data
      })

      req.on('end', () => {
        resolve(JSON.parse(_dataString))
      })
    })
  }

  // 判断chunkName 是否存在
  // console.log('need upload params:>> ',params);
  const { chunkName, hash, index } = await parseParams()
  const chunkDirectory = path.resolve(CHUNKS_DIR, hash)
  const _existed = fs.readdirSync(CHUNKS_DIR).includes(hash)
  const isChunkDirExisted = _existed && fs.statSync(chunkDirectory).isDirectory()
  const isChunkFileExisted = isChunkDirExisted && fs.readdirSync(chunkDirectory).includes(chunkName)

  // 存在则不需要客户端上传
  const result = { code: 0, should: !isChunkFileExisted }

  res.code = 200
  res.write(JSON.stringify(result))
  res.end()
  return
}
```

合并分片, 合并分片本身比较容易, 但是合并分片的时机必须要在客户端分片上传完毕的时候才能合并
服务器端是无法知道分片是否上传完毕的, 客户端只能通过 xhr onprogress 事件来获取分片上传进度
所以, 需要客户端统计整体进度, 当整体进度完成的时候发请求通知服务器可以合并了

另外需要注意的是

分片大小和网络传输事件中获取的大小不一致, 传事件的 loaded 加起来, 和 源文件的大小比较
上传事件的 loaded 加起来的统计大小是大于原文件大小的, 因为每个分片 blob 对象都是原数据还包含对象属性方法
所以 loaded 的大小是大于原文件大小的, 但 blob 对象传给 node 后端后直接读到的是原数据

## 服务器端合并

```JS
const mergeChunks = (hash, distName) => {
  // chunks dir 结合 hash , 读取所有分片
  const chunksFullPath = resolve(CHUNKS_DIR, hash)

  // dist file full path
  const distFileFullPath = resolve(UPLOAD_DIR, distName)

  // 遍历所有chunks
  const writeStream = fs.createWriteStream(distFileFullPath)
  const chunks = fs.readdirSync(chunksFullPath)

  // 排序和验证文件名
  const chunksList = chunks
    .map((chunk) => path.resolve(chunksFullPath, chunk))
    .sort((a, b) => parseInt(a.split('-')[1]) - parseInt(b.split('-')[1]))

  // let currentChunkIndex = 0
  const writeToDistFileEnd = (currentChunkIndex, writeStream) => {
    const chunksLength = chunksList.length
    if (currentChunkIndex > chunksLength - 1) return
    const chunk = chunksList[currentChunkIndex]
    const stat = fs.statSync(chunk)
    if (stat.isFile()) {
      const readStream = fs.createReadStream(chunk)
      readStream.pipe(writeStream, { end: false })
      // TODO 合并完成还需要删除分片目录吗?  但分片目录是用来判断是否需要上传的, 所以按理是不应该删除分片存放目录的, 但那样会很占用空间

      readStream.on('end', () => {
        if (currentChunkIndex === chunksLength - 1) {
          writeStream.end()
        } else {
          writeToDistFileEnd(currentChunkIndex + 1, writeStream)
        }
      })

      readStream.on('error', () => {
        writeStream.close()
      })
    }
  }

  writeToDistFileEnd(0, writeStream)
}
```

### 合并的时机

// 浏览器端统计整体进度, 在完成分片上传的时候, 通知服务器合并

```JS
      const updateTotalLoadedPercent = (index, loaded) => {
        chunkUploadedSizeList[index] = loaded || 0
        console.log('chunkListPercent', chunkUploadedSizeList)
        let totalLoaded = 0
        for (let _loaded of chunkUploadedSizeList) {
          // FIXED  有时这个统计数组中是空值, undefined 直接计算得到的结果则是NaN, 所以需要判断undefined的话则按0来计算
          totalLoaded += _loaded ? _loaded : 0
        }
        const totalLoadedPercent = (totalLoaded / container.size).toFixed(2)

        if (totalLoadedPercent >= 1 && chunkUploadedSizeList.length === chunkList.length) {
          request({
            url: NOTIFY_MERGE_URL + `?hash=${fileHash}&name=${container.name}`,
            method: 'get',
          })
        }
        return totalLoadedPercent
      }
```

## 其他

整体流程就是上面这些, 浏览器端代码和服务器端代码都是尽量使用原生代码
// 浏览器 xhr 封装的 request 请求方法

```JS
      function request({ url, onProgress = (e) => e, method = 'get', data, headers = {} }) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          // xhr.addEventListener('progress', onProgress )
          xhr.upload.onprogress = onProgress
          xhr.onload = (response) => resolve(response)
          xhr.onerror = (error) => reject(error)
          xhr.open(method, url, true)
          Object.keys(headers).forEach((key) => xhr.setRequestHeader(key, headers[key]))
          xhr.send(data)
        })
      }
```

服务器端使用 http 模块

// 浏览器 post 发送字符串

```JS
          const _data = JSON.stringify({
            chunkName,
            hash,
            index,
          })
          const _response = await request({
            url: IS_NEED_UPLOAD_URL,
            method: 'post',
            data: _data,
            // headers: {
            //   'Content-type': 'application/json',
            // },
          })
```

// 读取 req 流传递的 post 数据

```JS
    function parseParams() {
      return new Promise((resolve) => {
        let _dataString = ''
        req.on('data', (data) => {
          // console.log('needUpload req data: ', data)
          _dataString += data
        })

        req.on('end', () => {
          resolve(JSON.parse(_dataString))
        })
      })
    }
```

## 参考

<https://developer.mozilla.org/en-US/docs/Web/API/Blob/slice>
<https://juejin.cn/post/6844904046436843527#heading-13>
<https://www.jianshu.com/p/29e38bcc8a1d>
<https://github.com/satazor/js-spark-md5>
