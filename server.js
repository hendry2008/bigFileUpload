// https://juejin.cn/post/6844904046436843527#heading-4
const http = require('http')
const multiparty = require('multiparty')

const server = http.createServer()

server.on('request', (req, res) => {
  res.setHeader('Access-control-allow-origin', '*')
  res.setHeader('Access-control-allow-headers', '*')
  if (req.method.toLocaleLowerCase() === 'options') {
    res.status = 200
    res.end()
    return
  }

  // console.log('req :>> ', req)

  const url = req.url
  const method = req.method.toLocaleLowerCase()

  if (method === 'get' && url === '/') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html')
    res.write('hello , it works!\n')
    res.end()
    return
  }

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

      fields
      files
    })
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    const data = { success: 'ok'  }
    res.write(JSON.stringify(data))
    res.end()
    return
  }

  res.statusCode = 404
  res.setHeader('Content-Type', 'text/html')
  res.write('no found!!!!')
  res.end()
})

server.on('clientError', (err, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

server.listen(3002, () => console.log('Server listening on port 3002'))
