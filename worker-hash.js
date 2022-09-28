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
