# 抓取有道词典数据（逐义项中文释义 + 双语例句 + 同根词），用于考研词汇站
import urllib.request, json, os, time, sys, re
from concurrent.futures import ThreadPoolExecutor

BASE='https://dict.youdao.com/jsonapi?q='
OUT='data/youdao'
os.makedirs(OUT, exist_ok=True)

def fetch(word):
    fn=os.path.join(OUT, re.sub(r'[^a-z0-9_-]','_',word.lower())+'.json')
    if os.path.exists(fn) and os.path.getsize(fn)>200:
        return 'cached'
    url=BASE+urllib.parse.quote(word)
    for attempt in range(3):
        try:
            req=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0','Referer':'https://dict.youdao.com/'})
            data=urllib.request.urlopen(req, timeout=25).read()
            j=json.loads(data)
            if not j.get('ec') and not j.get('expand_ec') and not j.get('ee'):
                return 'empty'
            open(fn,'wb').write(data)
            return 'ok'
        except Exception as e:
            time.sleep(1.5*(attempt+1))
            err=str(e)
    return 'fail:'+err

def main():
    words=[w.strip() for w in open(sys.argv[1], encoding='utf-8') if w.strip()]
    print('words', len(words), flush=True)
    done=0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(fetch, words):
            done+=1
            if done%200==0: print(done, r, flush=True)
    from collections import Counter
    print(Counter(fetch(w) for w in words[:0]))

if __name__=='__main__':
    main()
