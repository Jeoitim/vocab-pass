# -*- coding: utf-8 -*-
"""预计算「同根词图」：base word -> 相关派生词。
六个词库共用一份，避免重复读 2 万个词典 JSON。"""
import json, os, re, csv

YD = 'data/youdao'
OUT = 'data/rel_map.json'
csv.field_size_limit(10**7)


def yj(w):
    fn = os.path.join(YD, re.sub(r'[^a-z0-9_-]', '_', w.lower()) + '.json')
    if not os.path.exists(fn):
        return None
    try:
        return json.load(open(fn, encoding='utf-8'))
    except Exception:
        return None


def related_of(w):
    """同根词：rel_word 关系图 + individual.derivative"""
    j = yj(w)
    if not j:
        return []
    out = []
    for g in (j.get('rel_word') or {}).get('rels', []):
        r = g.get('rel') or {}
        for it in r.get('words') or []:
            x = (it.get('word') or '').strip().lower()
            if x and x != w:
                out.append(x)
    indiv = j.get('individual') or {}
    for g in indiv.get('derivative') or []:
        for it in g.get('trans') or []:
            x = (it.get('word') or '').strip().lower()
            if x and x != w:
                out.append(x)
    return out


def main():
    # 所有词库的大纲词并集
    eco = {}
    with open('data/raw/ecdict.csv', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            eco[r['word'].strip().lower()] = r

    base = set(w.strip().lower() for w in open('data/base_words.txt') if w.strip())
    for tag in ['cet4', 'cet6', 'toefl', 'ielts', 'gre']:
        for w, r in eco.items():
            if tag in (r['tag'] or '').split():
                base.add(w)
    print('大纲词并集', len(base))

    rel = {}
    for i, w in enumerate(sorted(base)):
        rs = related_of(w)
        if rs:
            rel[w] = sorted(set(rs))
        if (i + 1) % 2000 == 0:
            print(' ', i + 1, '/', len(base), flush=True)
    json.dump(rel, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('写入', OUT, len(rel), '条', round(os.path.getsize(OUT) / 1e6, 2), 'MB')


if __name__ == '__main__':
    main()
