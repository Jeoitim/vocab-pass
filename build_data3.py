# -*- coding: utf-8 -*-
"""构建 VocabPass 词库数据（支持多词库）。

输出：
  www/data.js      词库索引 + 全部词条（KV_DECKS + KV_WORDS）
  build/index.json 供脚本/测试用

词条结构（紧凑键名）：
  w 单词   p 音标   m 释义   k 类型('b'大纲 / 'd'派生)   d 所属词库id
  s 义项 [{p:词性, c:释义, core:1(大纲义), e:[[en,zh],...]}]
  f 词形   r 同根词   ph 短语   mn 助记   sy 谚语   x 真题例句   g 通用例句
  y 含熟词生义(1)
"""
import json, os, re, csv, html, sys
from collections import OrderedDict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sense_judge as SJ

RAW = 'data/raw'
YD = 'data/youdao'
csv.field_size_limit(10 ** 7)
CJK = re.compile(r'[\u4e00-\u9fff]')


def norm(s):
    return re.sub(r'\s+', ' ', (s or '')).replace('\xa0', ' ').strip()


def strip_tags(s):
    s = html.unescape(s or '')
    return norm(re.sub(r'<[^>]+>', '', s))


def yj(w):
    fn = os.path.join(YD, re.sub(r'[^a-z0-9_-]', '_', w.lower()) + '.json')
    if not os.path.exists(fn):
        return None
    try:
        return json.load(open(fn, encoding='utf-8'))
    except Exception:
        return None


POS_MAP = {'n': 'n.', 'v': 'v.', 'vt': 'vt.', 'vi': 'vi.', 'a': 'adj.', 'adj': 'adj.',
           'ad': 'adv.', 'adv': 'adv.', 'prep': 'prep.', 'conj': 'conj.', 'pron': 'pron.',
           'num': 'num.', 'art': 'art.', 'int': 'int.', 'un.': 'n.', 'cn.': 'n.',
           'abbr.': 'abbr.', 'aux': 'aux.', 'det': 'det.', 'ord': 'num.'}


def parse_pos(p):
    p = (p or '').strip()
    if not p:
        return ''
    key = p.lower().replace('/', '').replace('&', '').rstrip('.')
    if key in POS_MAP:
        return POS_MAP[key]
    key2 = p.lower().replace('/', '').replace('&', '')
    if key2 in POS_MAP:
        return POS_MAP[key2]
    if key in ('adj', 'adv'):
        return key + '.'
    return p[:6]


# ---------------- ECDICT ----------------
eco = {}
with open(f'{RAW}/ecdict.csv', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        eco[norm(r['word']).lower()] = r


def eco_trans(w, full=False):
    r = eco.get(w)
    if not r:
        return ''
    t = (r['translation'] or '').replace('\\n', '；')
    t = re.sub(r'\[[^\]]*\]\s*', '', t)
    t = norm(t)
    return t if full else t[:110]


def eco_phon(w):
    r = eco.get(w)
    return norm(r.get('phonetic', '')) if r else ''


# 预计算的同根词图（build_relmap.py 生成）
REL_MAP = {}
if os.path.exists('data/rel_map.json'):
    REL_MAP = json.load(open('data/rel_map.json', encoding='utf-8'))


def pick_general_example(j, word):
    pairs = (j.get('blng_sents_part') or {}).get('sentence-pair') or []
    best = None
    for p in pairs:
        en = strip_tags(p.get('sentence-eng') or '')
        zh = strip_tags(p.get('sentence-translation') or '')
        if not en or not zh or not CJK.search(zh):
            continue
        if not (15 <= len(en) <= 120) or not (6 <= len(zh) <= 60):
            continue
        if not re.search(r'\b' + re.escape(word) + r'(s|es|ed|ing|d|ly)?\b', en, re.I):
            continue
        score = abs(len(en) - 45)
        if best is None or score < best[0]:
            best = (score, [en, zh])
    return best[1] if best else None


def build_record(word, phon, mean, kind, deck, outline='', freq_mode=False):
    j = yj(word) or {}
    ec = (j.get('ec') or {}).get('word') or []
    ec0 = ec[0] if ec else {}
    uk = norm(ec0.get('ukphone', ''))
    us = norm(ec0.get('usphone', ''))
    # 词条级考试标签：高中/CET4/CET6/考研/IELTS/TOEFL/GRE/GMAT/SAT/商务英语
    exam_tags = [norm(t) for t in ((j.get('ec') or {}).get('exam_type') or []) if t]
    forms = []
    for f in (ec0.get('wfs') or []):
        wf = f.get('wf') or {}
        nm, val = norm(wf.get('name')), norm(wf.get('value'))
        if nm and val and len(forms) < 8:
            forms.append([nm, val])

    # 原始义项
    ex = (j.get('expand_ec') or {}).get('word') or []
    tl = (ex[0] or {}).get('transList') if ex else []
    raw_senses = []
    for t in (tl or [])[:16]:
        cn = norm(t.get('trans', ''))
        if not cn:
            continue
        c = t.get('content') or {}
        exs = []
        for s in (c.get('sents') or []):
            en = strip_tags(s.get('sentOrig') or '')
            zh = strip_tags(s.get('sentTrans') or '')
            if not en or not zh:
                continue
            exs.append([en, zh])
            if len(exs) >= 3:
                break
        raw_senses.append({
            'p': parse_pos(c.get('detailPos') or ''),
            'c': cn,
            'e': exs,
            'tags': [e.get('zh') or e.get('en') for e in (c.get('examType') or [])],
        })

    # 义项归类（大纲义 / 熟词生义）
    marks = SJ.judge_word(word, outline, raw_senses, freq_mode=freq_mode)
    senses = [(s, m['kind']) for s, m in zip(raw_senses, marks)]

    cores = [x for x in senses if x[1] == 'core']
    rares = [x for x in senses if x[1] == 'rare']
    others = [x for x in senses if x[1] == 'other']
    # 大纲义最多 5 条、生义最多 6 条，不够时用中性义补齐
    keep = cores[:5] + rares[:6]
    if len(keep) < 6:
        keep += others[:6 - len(keep)]

    out_s = []
    for s, skind in keep:
        it = {'p': s['p'], 'c': s['c']}
        # g: 0=大纲义(core) 1=熟词生义(rare) 2=中性补充义(other)
        if skind == 'core':
            it['g'] = 0
        elif skind == 'rare':
            it['g'] = 1
        else:
            it['g'] = 2
        exs = s['e']
        lim = 1 if skind == 'core' else 2
        if exs:
            it['e'] = [e[:2] for e in exs[:lim]]
        out_s.append(it)

    phrs = []
    for p in ((j.get('phrs') or {}).get('phrs') or [])[:8]:
        phr = p.get('phr') or {}
        head = strip_tags(((phr.get('headword') or {}).get('l') or {}).get('i', ''))
        trs = []
        for tr in phr.get('trs') or []:
            v = strip_tags(((tr.get('tr') or {}).get('l') or {}).get('i', ''))
            if v:
                trs.append(v)
        if head and trs:
            phrs.append([head, '；'.join(trs[:2])])
        if len(phrs) >= 4:
            break

    rels, seen = [], set()
    for g in (j.get('rel_word') or {}).get('rels', []):
        r = g.get('rel') or {}
        pos = parse_pos(r.get('pos') or '')
        for it in r.get('words') or []:
            wd = norm(it.get('word', '')).lower()
            tr = norm(it.get('tran', ''))
            if not wd or wd in seen or wd == word.lower():
                continue
            seen.add(wd)
            rels.append([wd, pos, tr[:50]])
            if len(rels) >= 6:
                break
        if len(rels) >= 6:
            break

    indiv = j.get('individual') or {}
    mn = norm((indiv.get('mnemonic') or {}).get('method', ''))[:80]
    sy = None
    for s in (indiv.get('sayings') or []):
        if s.get('en') and s.get('zh'):
            sy = [strip_tags(s['en']), strip_tags(s['zh'])]
            break
    real = []
    for s in (indiv.get('pastExamSents') or []):
        if s.get('en') and s.get('zh'):
            real.append([strip_tags(s['en']), strip_tags(s['zh']), strip_tags(s.get('source', ''))])
        if len(real) >= 1:
            break

    rec = {'w': word, 'p': phon or us or uk, 'm': mean, 'k': kind, 'd': deck, 's': out_s}
    if exam_tags:
        rec['et'] = exam_tags
    if forms:
        rec['f'] = forms
    if rels:
        rec['r'] = rels
    if phrs:
        rec['ph'] = phrs
    if mn:
        rec['mn'] = mn
    if sy:
        rec['sy'] = sy
    if real:
        rec['x'] = real
    if any(x[1] == 'rare' for x in senses):
        rec['y'] = 1
    if not any(s.get('e') for s in out_s):
        g = pick_general_example(j, word)
        if g:
            rec['g'] = g
    return rec


# ---------------- 大纲词表来源 ----------------
# 国内有官方大纲的考试之间存在包含关系：
#   初中 ⊂ 高考 ⊂ 四级 ⊂ 六级，考研覆盖四六级基础词。
# ECDICT 的单标签存在漏标（如 credit 没标 cet4、a/able 没标 cet4），
# 所以用「层级并集」而不是单个标签。
TAG_SETS = {}


def _tagged(tag):
    if tag in TAG_SETS:
        return TAG_SETS[tag]
    st = set()
    for w, r in eco.items():
        if tag in (r['tag'] or '').split():
            st.add(w)
    TAG_SETS[tag] = st
    return st


def hierarchy_union(*tags):
    out = set()
    for t in tags:
        if isinstance(t, (set, frozenset)):
            out |= t
        else:
            out |= _tagged(t)
    return out


# 各词库的大纲词集合（模块级初始化一次）
OUTLINES = {}


def build_outlines(kaoyan_base):
    zk = _tagged('zk')
    gk = _tagged('gk')
    c4 = _tagged('cet4')
    c6 = _tagged('cet6')

    OUTLINES['cet4'] = gk | zk | c4          # 四级：含高考与初中基础词
    OUTLINES['cet6'] = OUTLINES['cet4'] | c6  # 六级：含四级
    OUTLINES['kaoyan'] = set(kaoyan_base) | OUTLINES['cet6']

    # 托福/雅思/GRE 没有国内大纲，但同为"出国英语"，
    # 用考试标签并集 + 六级基础词（留学考试默认要求过四六级）
    OUTLINES['ielts'] = _tagged('ielts') | OUTLINES['cet6']
    OUTLINES['toefl'] = _tagged('toefl') | OUTLINES['cet6']
    OUTLINES['gre'] = _tagged('gre') | OUTLINES['cet6']
    return OUTLINES


def words_from_set(wordset, freq_topup=0):
    """把词集合变成 {word: 释义}，可选按词频补全到一定规模。"""
    out = OrderedDict()
    for w in sorted(wordset):
        if not re.fullmatch(r"[a-z][a-z\-']*", w):
            continue
        tr = eco_trans(w, full=True)
        if tr:
            out[w] = tr
    if freq_topup > 0 and len(out) < freq_topup:
        # 词频补全：从高频词里挑还没收录的
        cands = []
        for w, r in eco.items():
            if w in out or not re.fullmatch(r"[a-z][a-z\-']*", w):
                continue
            try:
                frq = int(r['frq'])
            except (TypeError, ValueError):
                frq = 0
            try:
                bnc = int(r['bnc'])
            except (TypeError, ValueError):
                bnc = 0
            if frq <= 0 and bnc <= 0:
                continue
            cands.append(((frq or 999999, bnc or 999999), w))
        cands.sort()
        for _, w in cands:
            if len(out) >= freq_topup:
                break
            tr = eco_trans(w, full=True)
            if tr:
                out[w] = tr
    return out


def main():
    decks = []

    # ---------------- 考研：有正式大纲 ----------------
    hong = json.load(open(f'{RAW}/honghong_kaoyan.json', encoding='utf-8'))
    kaoyan_base = OrderedDict()
    for x in hong:
        w = norm(x['word'])
        k = w.lower()
        if k in kaoyan_base:
            continue
        kaoyan_base[k] = {'w': w, 'p': (x.get('yinbiao') or '').strip(), 'm': norm(x.get('mean', ''))}

    deriv = json.load(open('data/deriv_words.json', encoding='utf-8'))

    def make_deck(deck_id, name, sub, desc, base_map, with_outline=True, phon_map=None, wordset=None):
        """按「大纲词 + 派生词形」构建一个词库。

        base_map 决定过哪些词；wordset 决定派生词归属（通常更大，
        因为大纲层级里包含的基础词也算同族来源）。
        """
        words = []
        base_set = set(wordset) if wordset else set(base_map.keys())
        map_set = set(base_map.keys())
        for k, v in base_map.items():
            if isinstance(v, dict):
                words.append(build_record(v['w'], v['p'], v['m'], 'b', deck_id,
                                          v['m'] if with_outline else '', not with_outline))
            else:
                w = k
                ph = (phon_map or {}).get(w) or eco_phon(w)
                words.append(build_record(w, ph, base_map[w], 'b', deck_id,
                                          base_map[w] if with_outline else '', not with_outline))
        # 派生词：只从本词库的源词扩展
        deriv_added = 0
        for w in deriv:
            if w in map_set:
                continue
            # 派生词要能追到本词库的源词，避免把一个库的派生词塞进另一个库
            if not related_to_deck(w, base_set):
                continue
            tr = eco_trans(w)
            if not tr:
                continue
            words.append(build_record(w, eco_phon(w), tr, 'd', deck_id, eco_trans(w, True), not with_outline))
            deriv_added += 1
        nb = sum(1 for x in words if x['k'] == 'b')
        return words, nb, deriv_added

    def related_to_deck(w, base_set):
        """派生词是否属于本词库。

        依次尝试：
          1) 同根词图：某个大纲词的派生词里有它
          2) 词根族：与大纲词共享长词根前缀（credibility ← credit 的 cred-）
          3) ECDICT 词形关系
          4) 构词规则（后缀剥离）
        """
        parents = REL_MAP_PARENTS.get(w)
        if parents and (parents & base_set):
            return True

        # 词根族：取前 5~7 个字母作为词根，若本库有同词根的大纲词则算同族
        for L in (7, 6, 5):
            if len(w) > L:
                stem = w[:L]
                if any(b.startswith(stem) and len(b) > L for b in base_set):
                    return True

        r = eco.get(w)
        if r:
            ex = r.get('exchange') or ''
            for part in ex.split('/'):
                if part.startswith('0:') and part[2:].strip().lower() in base_set:
                    return True

        for suf in SUFFIXES:
            if w.endswith(suf) and len(w) - len(suf) >= 4:
                st = w[:-len(suf)]
                if st in base_set or (st + 'e') in base_set or (st + 'y') in base_set:
                    return True
                if st.endswith('i') and (st[:-1] + 'y') in base_set:
                    return True
        return False

    # 同根词图反向索引：派生词 -> 父词集合
    REL_MAP_PARENTS = {}
    for _p, _cs in REL_MAP.items():
        for _c in _cs:
            REL_MAP_PARENTS.setdefault(_c, set()).add(_p)

    SUFFIXES = ['ity', 'ness', 'ment', 'tion', 'ation', 'sion', 'ance', 'ence', 'ant', 'ent',
                'ive', 'ous', 'able', 'ible', 'al', 'ic', 'ly', 'er', 'or', 'ist', 'ism',
                'ize', 'ise', 'ify', 'ful', 'less', 'ee', 'ary', 'ory', 'ship', 'hood', 'dom']

    # 先构造大纲词集合
    build_outlines(kaoyan_base)

    # 考研：官方大纲 + 四六级基础词
    words, nb, nd = make_deck('kaoyan', '考研英语', '大纲 5500 词 + 派生词形',
                              '考研英语（一/二）大纲词汇', kaoyan_base, True,
                              wordset=OUTLINES['kaoyan'])
    decks.append({
        'id': 'kaoyan', 'name': '考研英语', 'sub': '大纲 5500 词 + 派生词形',
        'desc': '考研英语（一/二）大纲词汇，含同根派生与词形变化',
        'count': len(words), 'base': nb, 'deriv': nd,
        'hasOutline': True, 'ready': True,
    })
    shards = {'kaoyan': words}

    # 其他词库
    OTHERS = [
        ('cet4', '四级', 'CET-4', 0),
        ('cet6', '六级', 'CET-6', 0),
        ('ielts', '雅思', 'IELTS', 0),
        ('toefl', '托福', 'TOEFL', 0),
        ('gre', 'GRE', 'GRE', 0),
    ]
    for deck_id, name, en, topup in OTHERS:
        base_map = words_from_set(OUTLINES[deck_id], topup)
        if not base_map:
            decks.append({'id': deck_id, 'name': name, 'sub': en + ' 词汇',
                          'desc': en + ' 核心词汇', 'count': 0, 'base': 0, 'deriv': 0,
                          'hasOutline': deck_id in ('cet4', 'cet6'), 'ready': False})
            continue
        has_outline = deck_id in ('cet4', 'cet6')
        words, nb, nd = make_deck(deck_id, name, f'{en} {len(base_map)} 词 + 派生词形',
                                  en + ' 核心词汇', base_map, has_outline,
                                  wordset=base_map)
        decks.append({
            'id': deck_id, 'name': name, 'sub': f'{en} {len(base_map)} 词 + 派生词形',
            'desc': en + ' 核心词汇',
            'count': len(words), 'base': nb, 'deriv': nd,
            'hasOutline': has_outline, 'ready': True,
        })
        shards[deck_id] = words

    # 全局唯一 i
    idx = 0
    all_words = []
    for d in decks:
        for x in shards.get(d['id'], []):
            x['i'] = idx
            idx += 1
            all_words.append(x)

    deck_json = json.dumps(decks, ensure_ascii=False, separators=(',', ':'))

    os.makedirs('www/decks', exist_ok=True)
    for d in decks:
        sub = shards.get(d['id'])
        if not sub:
            continue
        with open(f'www/decks/{d["id"]}.js', 'w', encoding='utf-8') as f:
            f.write('window.KV_DECK_WORDS=')
            f.write(json.dumps(sub, ensure_ascii=False, separators=(',', ':')))
            f.write(';\n')

    default_id = decks[0]['id']
    with open('www/data.js', 'w', encoding='utf-8') as f:
        f.write('window.KV_DECKS=')
        f.write(deck_json)
        f.write(';\nwindow.KV_WORDS=')
        f.write(json.dumps(shards[default_id], ensure_ascii=False, separators=(',', ':')))
        f.write(';\n')

    # 统计
    print('=== 词库 ===')
    for d in decks:
        print(f"  {d['id']:8} {d['name']:6} {d['count']:6} 词 (大纲 {d['base']}, 派生 {d['deriv']})")
    tot = sum(d['count'] for d in decks)
    rare_w = sum(1 for x in all_words if x.get('y'))
    rare_s = sum(1 for x in all_words for s in x['s'] if s.get('g') == 1)
    tot_s = sum(len(x['s']) for x in all_words)
    print(f'合计 {tot} 词条, 含生义词 {rare_w}, 生义义项 {rare_s}/{tot_s} ({rare_s/max(1,tot_s):.1%})')
    print('data.js MB', round(os.path.getsize('www/data.js') / 1e6, 2))
    for d in decks:
        if d['ready']:
            p = f'www/decks/{d["id"]}.js'
            print(f'  decks/{d["id"]}.js', round(os.path.getsize(p) / 1e6, 2), 'MB')

    json.dump([{'w': x['w'], 'i': x['i'], 'd': x['d'], 'k': x['k'], 'y': x.get('y', 0)} for x in all_words],
              open('build/index.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    json.dump(decks, open('build/decks.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
