console.log('FSD_EVENT '+JSON.stringify({type:'status',message:'Native queue fixture ready'}))
process.stdin.resume()
process.stdin.once('end',()=>process.exit(0))
setInterval(()=>{},1000)
