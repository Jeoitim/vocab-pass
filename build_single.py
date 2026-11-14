# 把 index.html + style.css + app.js + data.js 打包成一个可离线打开的 HTML
import re, os, json, gzip
html=open('www/index.html',encoding='utf-8').read()
css=open('www/style.css',encoding='utf-8').read()
app=open('www/app.js',encoding='utf-8').read()
data=open('www/data.js',encoding='utf-8').read()

# 单文件版：图标与 manifest 内联/去掉，避免依赖外部文件
icon=open('www/icons/icon.svg',encoding='utf-8').read()
out=html
out=out.replace('<link rel="icon" href="icons/favicon-32.png" sizes="32x32">',
                '<link rel="icon" href="data:image/svg+xml;base64,'+__import__('base64').b64encode(icon.encode()).decode()+'">')
out=out.replace('<link rel="apple-touch-icon" href="icons/icon-192.png">','')
out=out.replace('<link rel="manifest" href="manifest.webmanifest">','')
out=out.replace('<img class="logo" src="icons/icon.svg" alt="" width="26" height="26">',
                '<img class="logo" src="data:image/svg+xml;base64,'+__import__('base64').b64encode(icon.encode()).decode()+'" alt="" width="26" height="26">')
out=out.replace('<link rel="stylesheet" href="style.css">', '<style>\n'+css+'\n</style>')
out=out.replace('<script src="data.js"></script>', '<script>\n'+data+'\n</script>')
out=out.replace('<script src="app.js"></script>', '<script>\n'+app+'\n</script>')
assert 'src="data.js"' not in out and 'src="app.js"' not in out and 'href="style.css"' not in out
os.makedirs('dist',exist_ok=True)
open('dist/VocabPass.html','w',encoding='utf-8').write(out)
print('single file MB', os.path.getsize('dist/VocabPass.html')/1e6)

# 分文件版（部署到 Cloudflare Pages 用这个目录内容）
os.makedirs('dist/site', exist_ok=True)
for f in ['index.html','style.css','app.js','data.js','manifest.webmanifest']:
    open('dist/site/'+f,'w',encoding='utf-8').write(open('www/'+f,encoding='utf-8').read())
os.makedirs('dist/site/icons', exist_ok=True)
for f in os.listdir('www/icons'):
    open('dist/site/icons/'+f,'wb').write(open('www/icons/'+f,'rb').read())
# 词库分片
os.makedirs('dist/site/decks', exist_ok=True)
for f in os.listdir('www/decks'):
    open('dist/site/decks/'+f,'w',encoding='utf-8').write(open('www/decks/'+f,encoding='utf-8').read())
print('site dir ready')
