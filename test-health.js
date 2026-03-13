// 测试 CoStrict 服务器健康检查
async function testHealthCheck() {
  const host = '127.0.0.1'
  const port = 5551
  const url = `http://${host}:${port}/doc`
  
  console.log(`Testing health check to ${url}...`)
  
  try {
    const response = await fetch(url, { 
      signal: AbortSignal.timeout(5000)
    })
    console.log(`✅ Status: ${response.status}`)
    console.log(`✅ OK: ${response.ok}`)
    
    if (response.ok) {
      console.log('✅ Health check PASSED')
      return true
    } else {
      console.log('❌ Health check FAILED')
      return false
    }
  } catch (error) {
    console.log('❌ Fetch error:', error.message)
    return false
  }
}

testHealthCheck().then(success => {
  console.log('Result:', success)
  process.exit(success ? 0 : 1)
})
