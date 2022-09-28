let _globalData
this.onmessage = (e) => {
  console.log('worker --- onmessage data :>> ', e.data)
  _globalData = e.data
}

// worker 中运行, 和 UI 线程无关
console.log('worker --- running...')
const request = ({ url, method = 'get', data, headers = {} }) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    Object.keys(headers).forEach((key) => {
      xhr.setRequestHeader(key, headers[key])
    })
    // xhr.onload = () => resolve(xhr)
    xhr.onload = () =>
      resolve({
        status: xhr.status,
        data: xhr.response,
      })
    xhr.onerror = () => reject({ status: xhr.status, statusText: xhr.statusText })
    xhr.open(method, url)
    xhr.send(data)
  })
}

const testUrl = 'http://localhost:3002'
request({ url: testUrl })
  .then((response) => console.log('response:', response))
  .catch((err) => console.log('err:', err))
async function sleep(milSeconds) {
  console.log('sleeping running ')
  return new Promise((resolve) => {
    setTimeout(() => resolve('sleep done...'), milSeconds)
  })


;(async function () {
  console.log(await sleep(5000))
})()

// 如果需要访问主线程发送来的数据的话, 那么只能放在onmessage中获取变量后调用
function calculate() {
  return `worker --- Im worker1 foo :>> ${_globalData}`
}
