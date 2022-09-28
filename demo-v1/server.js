// https://juejin.cn/post/6844904046436843527#heading-4
const http = require('http')
const multiparty = require('multiparty')
const fs = require('fs')
// const fs = require('fs-extra')
const path = require('path')
const { resolve } = require('path')
const UPLOAD_DIR = 'upload'


const server = http.createServer()

const uploadSessions = {}

server.on('request',async (req, res) => {
  res.setHeader('Access-control-allow-origin', '*')
  res.setHeader('Access-control-allow-headers', '*')
  if (req.method.toLocaleLowerCase() === 'options') {
    res.status = 200
    res.end()
    return
  }

  // console.log('req :>> ', req)

  const url = req.url.split('?')[0]
  const method = req.method.toLocaleLowerCase()

  if (method === 'get' && url === '/') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html')
    res.write('hello , it works!\n')
    res.end()
    return
  }

  /***
   * @description 上传的分片和字段的处理
   */
  if (method === 'post' && url === '/upload') {
    // multiparty 处理上传的 form-data
    const form = new multiparty.Form()
    form.parse(req, function (err, fields, files) {
      if (err) {
        console.log('err :>> ', err)
        res.statusCode = 500
        res.end(`error: ${err.toString()}`)
        return
      }

      // fields 是客户端发送的formData append 拼装的数据
      // const { index, name } = fields.name
      const [name] = fields.name
      const [index] = fields.index
      const [uploadId] = fields.uploadId
      const { path } = files.chunk[0]

      if (!uploadSessions[uploadId]) uploadSessions[uploadId] = []
      uploadSessions[uploadId][index] = path
      // console.log('fields:', JSON.stringify(fields, null, 4), 'files:', JSON.stringify(files, null, 4))
      // console.log(`index: ${index} - ${path}`)
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
   */

  if (method === 'get' && url === '/merge') {
    // 从url 获取参数
    const params = {}
    const paramsString = req.url.includes('?') ? req.url.split('?')[1] : ''
    const entries = paramsString.split('&')
    entries.forEach((entry) => {
      const [key, value] = entry.split('=')
      params[key] = value
    })

    const { uploadId } = params
    // FIXED 
    // 当上传很小的文件的时候, 可能会先处理 merge, 还没有来得及运行 multiParty.parse 方法, 
    // 于是这里 uploadSessions[uploadId] 可能还是 undefined , 
    // 所以需要给 chunks 默认为空数组
    // 或者sleep 很短时间确保在极端快上传的情况下, merge 运行一定能读取到 parse 处理后的变量
    // 这里是两种保障都使用
    await sleep(500)
    const chunks = uploadSessions[uploadId] || []
    // const chunks = uploadSessions[uploadId]
    const originFileName = uploadId.split('|')[0]
    mergeDataFileEnd(chunks, originFileName, uploadId)
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html')
    res.write(`merge, ${JSON.stringify(params)}`)
    res.end()
    return
  }

  res.statusCode = 404
  res.setHeader('Content-Type', 'text/html')
  res.write('no found!!!!')
  res.end()
})
/***
 * @chunkPathList { String [] }  chunk 文件path 数组
 * @distFile { String } 目标文件
 * @description 合并, 逐个读取chunk 写入到目标文件的末尾 
 */

function mergeDataFileEnd(chunkPathList, distFile, uploadId) {
  const distFileFullPath = path.resolve(__dirname, UPLOAD_DIR, distFile)
  const _writeStream = fs.createWriteStream(distFileFullPath)
  let _currentChunkIndex = 0

  const appendFileEnd = (currentChunkIndex, writeStream) => {
    if (currentChunkIndex > chunkPathList.length - 1) return
    const chunkPath = chunkPathList[currentChunkIndex]
    const readStream = fs.createReadStream(chunkPath)
    readStream.pipe(writeStream, { end: false })

    readStream.on('error', (error) => {
      console.log('readStream error :>> ', error)
      writeStream.close()
    })

    readStream.on('end', () => {
      if (currentChunkIndex === chunkPathList.length - 1) {
        writeStream.end()
        // 删除chunkList这些临时文件
        chunkPathList.forEach(chunk => {
          fs.unlinkSync(chunk)
        })
        // 清除 uploadSession 中的这个上传记录
        delete uploadSessions[uploadId]
        return
      } else {
        _currentChunkIndex += 1
        appendFileEnd(_currentChunkIndex, writeStream)
      }
    })
  }
  appendFileEnd(_currentChunkIndex, _writeStream)
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
