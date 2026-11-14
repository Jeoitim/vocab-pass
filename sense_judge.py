# -*- coding: utf-8 -*-
"""义项归类：判断有道的每个义项属于「大纲义（core）」还是「熟词生义（rare）」。

判定优先级（任一命中即 core）：
  1. 大纲释义里出现的说法，经同义组扩展后与义项重合
  2. 义项带考研/四级/六级/高中标签（说明是大纲要求掌握的意思）
  3. 义项是词典第一义（最常用义）
  4. 义项与大纲释义同词性且共享 ≥2 字长公共子串（兜底）

生义要求：不在 1-3 之内，且与大纲释义确实不同；为了不误伤，
判定为生义时还要求该义项带例句（无例句的生义看不出来，不如不标）。
"""
import re
import gloss_syn as GS

CJK = re.compile(r'[\u4e00-\u9fff]')
PAREN = re.compile(r'（[^）]*）|\([^)]*\)|<[^>]*>|\[[^\]]*\]')
POS_ALIAS = {
    'n': 'n', 'noun': 'n',
    'v': 'v', 'vt': 'v', 'vi': 'v', 'verb': 'v',
    'a': 'adj', 'adj': 'adj', 'adjective': 'adj',
    'ad': 'adv', 'adv': 'adv', 'adverb': 'adv',
    'prep': 'prep', 'conj': 'conj', 'pron': 'pron',
    'num': 'num', 'art': 'art', 'int': 'int', 'aux': 'aux', 'abbr': 'abbr',
}
CORE_EXAM = {'考研', '四级', '六级', '高中'}


def split_gloss(s):
    """把一条中文释义切成片段：去掉括注，按标点切开，保留 2-8 字。"""
    s = PAREN.sub(' ', s or '')
    s = CJK.sub(lambda m: m.group(0), s)  # 保留中文
    s = re.sub(r'[^\u4e00-\u9fff]+', '|', s)
    out = []
    for p in s.split('|'):
        p = p.strip()
        if 2 <= len(p) <= 8:
            out.append(p)
    return out


def norm_pos(p):
    p = (p or '').lower().strip().rstrip('.')
    p = p.replace('/', '').replace('&', '').replace(' ', '')
    for k, v in POS_ALIAS.items():
        if p == k or p.startswith(k):
            return v
    return p


def lcs_len(a, b, cap=4):
    """最长公共子串长度（只关心 >=2）。"""
    if not a or not b:
        return 0
    best = 0
    la, lb = len(a), len(b)
    prev = [0] * (lb + 1)
    for i in range(1, la + 1):
        cur = [0] * (lb + 1)
        ai = a[i - 1]
        for j in range(1, lb + 1):
            if ai == b[j - 1]:
                cur[j] = prev[j - 1] + 1
                if cur[j] > best:
                    best = cur[j]
                    if best >= cap:
                        return best
        prev = cur
    return best


def match_outline(sense_cn, outline_segs, outline_gloss_keys):
    """义项说法是否落在大纲释义范围内（含同义扩展）。

    比较时两边都做 canon 归一（去「的」等），
    并允许「义项说法包含大纲说法」——如大纲「孤独的」对上义项「孤独忧伤的」。
    """
    osegs_c = [GS.canon(o) for o in outline_segs]
    for seg in split_gloss(sense_cn):
        for v in GS.expand(seg):
            v = GS.canon(v)
            if not v or len(v) < 2:
                continue
            if v in outline_gloss_keys:
                return True
            for o in osegs_c:
                if not o or len(o) < 2:
                    continue
                if v in o or o in v:
                    return True
    # 兜底：够长的公共子串
    for seg in split_gloss(sense_cn):
        for o in osegs_c:
            if lcs_len(seg, o, 3) >= 3:
                return True
    return False


def judge_word(word_rec, outline_mean, senses, freq_mode=False):
    """返回每个义项的归类：core（大纲义）/ rare（熟词生义）/ other（中性）。

    freq_mode=False（有官方的纲）：
      1. 匹配大纲释义（含同义扩展）→ core
      2. 带考研/四级/六级/高中/高考标签 → core
      3. 同词性 + 长公共子串兜底 → core
    freq_mode=True（没有大纲，如托福/雅思/GRE，用词频作"纲"）：
      1. 大纲释义换成"词频排序出来的高频义"，即义项顺序靠前 + 有例句
      2. 仍优先采信考试标签
    两类都遵循：其余义项有例句 → rare；无例句 → other。
    只要有一个 core 就算"在纲内"，避免整词都被判生义。
    """
    outline_mean = outline_mean or ''
    osegs = split_gloss(outline_mean)
    okeys = set()
    for seg in osegs:
        okeys.add(seg)
        okeys |= {GS.canon(x) for x in GS.expand(seg)}

    opos = set()
    for m in re.finditer(r'(?:^|[\s；;，,、])((?:[a-z]{1,5}\.){1,3})', outline_mean):
        for part in re.findall(r'([a-z]{1,5})\.', m.group(1)):
            opos.add(norm_pos(part))

    kinds = []
    for i, s in enumerate(senses):
        cn = s.get('c') or ''
        pos = norm_pos(s.get('p'))
        tags = set(s.get('tags') or [])
        has_ex = bool(s.get('e'))

        if tags & CORE_EXAM:
            kinds.append('core')
            continue

        if not freq_mode:
            if cn.strip() and match_outline(cn, osegs, okeys):
                kinds.append('core')
                continue
            if pos and pos in opos and cn.strip():
                hit = False
                for seg in split_gloss(cn):
                    for o in osegs:
                        if lcs_len(GS.canon(seg), GS.canon(o), 3) >= 3:
                            hit = True
                            break
                    if hit:
                        break
                if hit:
                    kinds.append('core')
                    continue
        else:
            # 无大纲：前两个义项视为该词的核心义（词典按常用度排序）
            if i < 2 and cn.strip():
                kinds.append('core')
                continue

        kinds.append('rare' if (has_ex and cn.strip()) else 'other')

    # 兜底：一条 core 都没有时，第一个义项当核心义
    if kinds and 'core' not in kinds and kinds[0] in ('rare', 'other'):
        kinds[0] = 'core'

    return [{'core': 1 if k == 'core' else 0, 'kind': k} for k in kinds]


def summarize(senses, marks):
    cores = sum(1 for m in marks if m['kind'] == 'core')
    rares = sum(1 for m in marks if m['kind'] == 'rare')
    return cores, rares
