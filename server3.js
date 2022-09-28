// https://juejin.cn/post/6844904046436843527#heading-4
const http = require('http')
const multiparty = require('multiparty')
const fs = require('fs')
const path = require('path')
const { resolve } = require('path')
const UPLOAD_DIR = path.resolve(__dirname, 'upload')
const CHUNKS_DIR = path.resolve(__dirname, 'chunks')

// 在当前目录新建upload目录和chunks目录
const _existedChunks = fs.readdirSync(__dirname).includes('chunks')
const _dirExistedChunks = _existedChunks && fs.statSync(CHUNKS_DIR).isDirectory()
if (!_dirExistedChunks) {
  fs.mkdirSync(CHUNKS_DIR)
}
const _existedUpload = fs.readdirSync(__dirname).includes('upload')
const _dirExistedUpload = _existedUpload && fs.statSync(UPLOAD_DIR).isDirectory()
if (!_dirExistedUpload) {
  fs.mkdirSync(UPLOAD_DIR)
}

const server = http.createServer()

server.on('request', async (req, res) => {
  res.setHeader('Access-control-allow-origin', '*')
  res.setHeader('Access-control-allow-headers', '*')
  if (req.method.toLocaleLowerCase() === 'options') {
    res.status = 200
    res.end()
    return
  }

  // console.log('req :>> ', req)
  const urlPath = req.url.split('?')[0]
  const method = req.method.toLocaleLowerCase()

  if (method === 'get' && urlPath === '/') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html')
    res.write('hello , it works!\n')
    res.end()
    return
  }

  /***
   * @description 上传的分片和字段的处理
   * 获取上传的chunk的时候,  根据hash 创建目录
   * 并且把相关的 chunk 都放到该目录下,
   * 后续需要根据这个目录和hash实现秒传,续传
   */
  if (method === 'post' && urlPath === '/upload') {
    // multiparty 处理上传的 form-data
    const form = new multiparty.Form()
    form.parse(req, function (err, fields, files) {
      if (err) {
        console.log('err :>> ', err)
        res.statusCode = 500
        res.end(`error: ${err.toString()}`)
        return
      }
      try {
        // fields 是客户端发送的formData append 拼装的数据
        const [index] = fields.index
        const [hash] = fields.hash
        const { path: chunkPath } = files.chunk[0]
        // 每个hash 对应一个上传的大文件,
        // 所以把它的所有的分片都移动到该 hash 命名的目录, 这样可以不同记录session
        // 而且如果其他用户传相同的文件, 那么hash也相同, 可以实现秒传功能
        const chunkDirectory = path.resolve(CHUNKS_DIR, hash)
        // 判断分片目录是否存在
        const _existed = fs.readdirSync(CHUNKS_DIR).includes(hash)
        const isChunkDirExisted = _existed && fs.statSync(chunkDirectory).isDirectory()
        if (!isChunkDirExisted) fs.mkdirSync(chunkDirectory)
        // 分片新路径名
        const newChunkPath = path.resolve(chunkDirectory, `${hash}-${index}`)
        // 移动分片文件
        // fs.renameSync(chunkPath, newChunkPath)
        const _readerStream = fs.createReadStream(chunkPath)
        const _writeStream = fs.createWriteStream(newChunkPath)
        _readerStream.pipe(_writeStream)
        // move 完毕则删除原本的临时目录下的chunk
        _readerStream.on('end', () => {
          fs.unlinkSync(chunkPath)
        })
        _readerStream.on('error', () => _writeStream.close())
      } catch (error) {
        console.log('parse error :>> ', error)
      }
    })
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    const data = { success: 'ok' }
    res.write(JSON.stringify(data))
    res.end()
    return
  }

  /***
   * @description 客户端合请求merge 则合并分片
   * 获取hash 得到chunks upload 目录
   * 获取文件名,   最终合并为该文件
   */

  if (method === 'get' && urlPath === '/merge') {
    const params = parseUrlQuery(req.url)
    const { hash, name } = params
    // FIXED
    // 当上传很小的文件的时候, 可能会先处理 merge, 还没有来得及运行 multiParty.parse 方法,
    // 于是这里 uploadSessions[uploadId] 可能还是 undefined ,
    // 所以需要给 chunks 默认为空数组
    // 或者sleep 很短时间确保在极端快上传的情况下, merge 运行一定能读取到 parse 处理后的变量
    // 这里是两种保障都使用
    await sleep(500)

    mergeChunks(hash, name)
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html')
    res.write(`merge, ${JSON.stringify(params)}`)
    res.end()
    return
  }

  /***
   * @description 提供查询api判断分片是否存在, 让客户端可以秒传
   * @param chunkName {String} 待检查chunk名, 包含hash 和 index
   */
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

  // 其他请求返回404
  res.statusCode = 404
  res.setHeader('Content-Type', 'text/html')
  res.write('no found!!!!')
  res.end()
})

//test "/merge?hash=123sdf123&name=video123"
const parseUrlQuery = (url) => {
  const queryString = url.split('?')[1]
  if (!queryString) return {}
  // 从url 获取参数
  const params = {}
  const entries = queryString.split('&')
  entries.forEach((entry) => {
    const [key, value] = entry.split('=')
    if (key) params[key] = decodeURI(value)
  })
  return params
}
/***
 * @description 合并, 逐个读取chunk 写入到目标文件的末尾
 * @param hash { String }  container文件分片数组 hash
 * @param distFile { String } 目标文件
 */

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

// 对同一个文件, 多次 createWriteStream 进行写入

server.on('clientError', (err, socket) => {
  socket.end(`HTTP/1.1 400 Bad Request, ${err}\r\n\r\n`)
})

async function sleep(milSeconds) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), milSeconds)
  })
}
server.listen(3002, () => console.log('Server listening on port 3002'))
