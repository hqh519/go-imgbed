<template>
  <div class="docs-page">
    <div class="docs-container">
      <header class="docs-header">
        <div class="docs-header-main">
          <h1 class="docs-title">
            <font-awesome-icon icon="book" />
            <span>{{ t('title') }}</span>
          </h1>
          <p class="docs-subtitle">{{ t('subtitle') }}</p>
        </div>
        <div class="docs-header-actions">
          <el-button size="small" @click="toggleLocale">
            <font-awesome-icon icon="globe" style="margin-right: 6px;" />
            {{ $i18n.locale === 'zh-CN' ? 'English' : '简体中文' }}
          </el-button>
          <el-button size="small" type="primary" @click="goBack">
            <font-awesome-icon icon="arrow-left" style="margin-right: 6px;" />
            {{ t('backHome') }}
          </el-button>
        </div>
      </header>

      <div class="docs-body">
        <!-- 目录 -->
        <aside class="docs-toc">
          <div class="toc-title">{{ t('toc') }}</div>
          <a
            v-for="section in sections"
            :key="section.id"
            class="toc-item"
            :class="{ 'is-active': activeSection === section.id }"
            :href="`#${section.id}`"
            @click.prevent="scrollTo(section.id)"
          >{{ section.title }}</a>
        </aside>

        <!-- 正文 -->
        <main class="docs-content">
          <section v-for="section in sections" :id="section.id" :key="section.id" class="doc-section">
            <h2 class="doc-section-title">{{ section.title }}</h2>
            <p v-if="section.intro" class="doc-section-intro">{{ section.intro }}</p>
            <ul class="doc-list">
              <li v-for="(item, i) in section.items" :key="i">
                <span class="doc-item-title">{{ item.t }}</span>
                <span v-if="item.d" class="doc-item-desc">{{ item.d }}</span>
                <ul v-if="item.sub && item.sub.length" class="doc-sublist">
                  <li v-for="(s, j) in item.sub" :key="j">{{ s }}</li>
                </ul>
              </li>
            </ul>
          </section>

          <footer class="docs-footer">
            <span>{{ t('footer') }}</span>
          </footer>
        </main>
      </div>
    </div>
  </div>
</template>

<script>
import { setLocale } from '@/locales';

const ZH = {
  title: '使用文档',
  subtitle: '上传、外链、存储渠道、去重与备份的完整说明',
  toc: '目录',
  backHome: '返回上传页',
  footer: '本文档随系统内置，内容与当前版本行为保持一致。',
  sections: [
    {
      id: 'quickstart',
      title: '一、快速开始',
      intro: '支持三种上传方式，上传页右上角的第二个按钮可在「文件上传 / 粘贴板上传」之间切换。',
      items: [
        { t: '文件上传', d: '点击或拖拽文件到上传区，可多选；也可选择整个文件夹（会保留相对目录结构）。上传目录可在顶部输入框填写，留空即根目录。' },
        { t: '粘贴板上传', d: '切到「粘贴板上传」后，可直接粘贴图片/文件，或粘贴一个或多个 URL。' },
        { t: '转存（URL 上传）', d: '粘贴外链后选择「转存」：服务端会把该 URL 的文件抓取回来，再按当前渠道重新上传，返回本站外链。选择「外链」则只登记外链、不落盘。' },
        { t: '文件命名方式（v2.8.8）', d: '上传设置里已不再提供该项 —— 一律按后台「其他设置 → 上传相关配置 → 默认命名方式」执行，避免同一账户在不同页面得到不同文件名。' },
        { t: '登记文件（v2.8.8）', d: '上传页右下角快捷栏「上传设置」上一个按钮，后台「文件管理 → 新建目录」右侧也有同名入口。用于把一个已经存在于对象存储 / 别的图床的文件登记进系统：只填源地址、名称（可留空）、渠道、分类、备注，类型 / 大小 / MD5 由服务端探测，上传时间取提交时间，上传方式记为 Record，自动打上 年份 / 扩展名 / 渠道简称 / 类型 / Record 标签，不重复上传、不占用上传流量。登记的文件删除时只删记录，不动源文件。' },
        { t: '视频兼容转码（账户策略，v2.8.8）', d: '后台「用户管理 → 编辑」的「管理员操作」里可对单个账户设置：跟随全局 / 禁用 / 启用 / 用户决定。选「用户决定」时，该账户在上传页「上传设置 → 文件预处理」里会看到同名下拉（跟随全局 / 禁用 / 启用），且每次刷新复位为「跟随全局」。策略对该账户的全部上传入口生效（首页、链接转存、WebDAV、API-S3、API-Web）。' },
        { t: '单文件大小限制（账户级，v2.8.8）', d: '后台「用户管理 → 编辑 → 管理员操作」里填写，留空或 0 表示跟随后台全局上限；填写后对该账户全部上传入口生效，超限时提示里会说明是账户限制还是全局限制。「类型和大小限制」开关已移除。' },
        { t: '禁止压缩格式', d: '位置在「上传设置 → 文件压缩 → 压缩百分比」之后：清单内的格式跳过压缩、原样上传（例如填 mp4 就不压视频）；留空则不排除任何格式，可压缩类型全部按规则压缩。内置可压缩清单：jpg/jpeg/jfif/png/webp/avif、mp4/webm/mov/m4v/mkv、mp3/m4a/aac/wav/flac/ogg/opus。' },
        { t: '压缩体积保障', d: '压缩/重编码后只要体积没有变小（等于或大于原文件），直接丢弃压缩产物、继续上传原文件，不会出现「越压越大」；唯一例外是视频兼容转码 —— 为保证浏览器能正常播放，H.265/HEVC 转 H.264 后即使变大也保留，系统日志会记录体积变化。' },
        { t: '视频兼容转码', d: '开关在「其他设置 → 上传相关配置 → 视频兼容转码」：上传 H.265/HEVC、ProRes 等浏览器放不了的编码时，服务端自动转 H.264（需 ffmpeg）；已是 H.264/AV1/VP9 的视频不转码，与压缩开关相互独立。' },
        { t: '后置处理（v2.8.8 重要变化）', d: '视频 / 音频的压缩与兼容转码不再放在上传请求里：文件落库、渠道写入成功后立即返回外链，压缩与转码由后台单通道队列串行执行（全局同时只有 1 路 ffmpeg）。顺序固定为「先压缩 → 再转码」——压缩走 libx264，产物本身就是 H.264，压缩成功就直接收工不再转码。' },
        { t: '后置处理的放弃策略', d: '任何时候都以「上传成功」为最高优先级：①预计耗时超过 5 分钟（MEDIA_POST_MAX_SECONDS）直接放弃；②CPU 少于 2 核、1 分钟负载超过核数 ×1.5、可用内存低于 256MB 时跳过；③压缩判定会失败 → 压缩与转码都放弃；④压缩成功但转码会失败 → 保留压缩结果、放弃转码；⑤执行超时同样放弃。放弃时渠道上的原文件与库记录保持上传时的状态，外链照常可访问，系统日志会写明放弃原因。' },
        { t: 'WebP转换 / 文件压缩 现在是总开关（v2.8.8）', d: '后台「其他设置 → 上传相关配置」里这两项从「默认值」升级为「总开关」：关闭「WebP转换」→ 上传页列表顶栏的「转换为WebP」按钮不加载；关闭「文件压缩」→ 顶栏「文件压缩」按钮、上传设置里的开关/阈值/百分比/禁止格式全部隐藏，「最小压缩阈值」「默认压缩期望」在后台也一并隐藏（值不清空，重新打开即恢复）。' },
        { t: '自动重试（v2.8.8 迁移）', d: '原上传设置里的「自动重试」开关已迁到后台「其他设置 → 上传相关配置 → 自动重试」（位于「视频兼容转码」上一行），值入库、对所有账户统一生效，前台上传页不再显示该开关。' }
      ]
    },
    {
      id: 'url',
      title: '二、外链格式与复制',
      intro: '同一份文件会同时生成四种格式，按「链接格式」对话框中选择的默认格式复制。',
      items: [
        { t: '原始链接', d: '形如 https://你的域名/file/<File_ID>.jpg —— 末尾的扩展名只用于直观识别类型，去掉后同样可以访问。' },
        { t: 'Markdown', d: '![文件名](链接)' },
        { t: 'HTML', d: '<img src="链接" alt="文件名">' },
        { t: 'BBCode', d: '[img]链接[/img]' },
        { t: '自定义 URL 前缀', d: '用于 CDN 加速等场景：设置后会替换外链域名，请确保该前缀可访问。' },
        { t: '关于扩展名', d: '后端按「去掉最后一段扩展名」查库，因此带扩展名、不带扩展名都能访问，也不会影响代理转发、302 重定向与访问源切换。' }
      ]
    },
    {
      id: 'channels',
      title: '三、存储渠道',
      intro: '系统设置 → 上传设置中管理渠道，共 9 种类型。',
      items: [
        {
          t: '渠道类型',
          sub: [
            '专属通道（有独立适配器实现）：腾讯云 COS、阿里云 OSS、MinIO、Cloudflare R2、S3 兼容存储、WebDAV、Immich',
            '通用兼容（与「自定义 Web 通道」共用 HTTP 上传适配器，按预设字段自动适配）：EasyImages、Lsky Pro、自定义 Web 通道'
          ]
        },
        { t: '自定义 Web 通道', d: '只需「上传接口地址 + 文件表单字段名 + 响应 URL 路径」三件套；需要鉴权或附加参数时，用「自定义请求头 (JSON)」与「附加表单字段 (JSON)」。请求方法可选 POST/PUT/PATCH，请求体可选 multipart 或 JSON+Base64。' },
        { t: '主渠道与备份渠道', d: '主渠道同步上传（决定上传耗时），备份渠道异步双写（不阻塞响应）。每个渠道可单独启用/禁用。' },
        { t: '停用渠道（v2.8.6）', d: '关掉某个渠道右上角的启用开关后：它不会出现在任何渠道下拉 / 渠道选择里（上传设置、Token、用户管理、系统状态一致），也不再接受任何来源的上传 —— 网页、WebDAV、API 显式指定该渠道时会直接报「渠道已停用」，不会静默改投别的渠道。' },
        { t: '公开访问域名 / 内网通信域名（v2.8.7）', d: '各渠道编辑页的域名字段统一命名为「公开访问域名」。简单图床、兰空图床、Immich、MinIO、S3、WebDAV、自定义Web 还支持「内网通信域名（可选）」：填容器内网 IP 或容器名后，系统内部加载该渠道文件的所有地方（文件管理、详情、历史记录、访客图库、签发外链的代理转发）都优先走内网取流 —— 提速且省公网流量；为空则用公开访问域名，再为空用 Endpoint。文件详情页「存储渠道 / 备份渠道」的渠道源链接始终用公开访问域名（内网地址外网打不开）。302 重定向模式下外链同样走公开访问域名。' },
        { t: '容量限制', d: '勾选「启用容量限制」后才会出现「容量上限」「告警阈值」；超出阈值的渠道不再参与上传分流，避免写满。' },
        { t: '测试连接', d: '新增或编辑渠道时可点「测试连接」验证配置，成功会返回一条可点击查看的直链。' },
        {
          t: '内网直连（上传提速）',
          sub: [
            '渠道地址（Endpoint / 服务地址 / 上传接口地址）支持直接填内网 IP 或 Docker 容器名，例如 minio:9000、immich:2283、lsky:8080、192.168.1.10:9000、nas.local。',
            '适用场景：go-imgbed 与 MinIO / Immich / 兰空 / WebDAV 部署在同台 NAS、同一个 docker 网络里 —— 走内网通信不经公网、不绕 CDN，上传明显更快。',
            '不写协议时系统自动判断：内网地址 / 容器名按 http，公网域名按 https（自建服务通常未开 TLS，一律补 https 会直接连不上）。',
            '渠道通信全部由服务端发起（后端去 PUT/POST 文件），浏览器只负责提交配置 —— 所以图床自身对外是 https 并不影响用 http://minio:9000 这类内网地址通信，也不存在混合内容拦截。',
            '读写都能走内网：「外链域名 / 公开访问域名」是外链的域名前缀，取值取决于外链分发模式 —— 代理模式（默认）下取流由服务端发起，这里填内网地址即可让读写全走内网、速度最快，访客看到的仍是图床自己的域名；302 重定向模式下访客浏览器会直接打开该地址，必须填公网可访问地址。'
          ]
        }
      ]
    },
    {
      id: 'deliver',
      title: '四、外链分发（代理 / 302）',
      items: [
        { t: '代理模式（默认）', d: '服务端拉取上游字节再转发，外链地址恒定不变，支持 Range 断点/拖动播放，上游故障可自动降级到另一渠道。' },
        { t: '302 重定向', d: '由浏览器直接访问上游图床，服务端流量最小，适合上游本身带宽充足的情况。' },
        { t: '当前访问源', d: '在主渠道与备份渠道之间一键切换，切换后所有存量外链立即生效，无需重新上传。' },
        { t: '代理参数', d: '可调上游超时与客户端缓存时长（0 表示不缓存）。' }
      ]
    },
    {
      id: 'dedup',
      title: '五、上传去重（秒传）',
      items: [
        { t: '判定规则', d: '上传一开始就按「压缩前的原文件」算 MD5 与大小并查库：MD5 相同且大小一致即判定重复，直接返回已有外链，不再做图像审查、压缩、转码和上传。' },
        { t: '为什么用原始大小', d: '同一份原文件在不同压缩档位下压出来的字节数并不稳定（JPEG 重编码、ffmpeg 转码都有浮动）。用压缩后的体积比对，会出现「同一个文件却判不成重复」，所以统一按原始大小 + 原始 MD5 比对。' },
        { t: 'MD5 口径', d: '文件记录里的 MD5 存的是原始文件内容的 MD5，原样上传的历史记录同样能被命中；老数据缺失原始大小时用当前大小兜底。' },
        { t: '去重范围：所有渠道之间', d: '只要 MD5 与大小相同即视为重复（默认模式，最省空间）。' },
        { t: '去重范围：同一渠道类型内（v2.8.7b）', d: '先比对渠道类型，类型相同再比大小与 MD5 —— 同一类型（如多个 S3 渠道）之间互相去重，不同类型各存一份。' },
        { t: '去重范围：同一渠道名称内（v2.8.7b）', d: '先比对渠道名称，名称相同再比大小与 MD5：同一份文件可以分别落到不同渠道（同名渠道之间仍会去重）。' },
        { t: '开关位置', d: '后台「存储与分发设置」里去重开关与去重范围可随时切换，关闭后每次都真实上传。' }
      ]
    },
    {
      id: 'backup',
      title: '六、备份、配置备份与一键备份',
      items: [
        { t: '配置备份 / 恢复配置', d: '系统状态页「系统管理 → 配置备份」把系统配置项（网页 / 安全 / 其他 / AI 各设置分区，含白名单、邮箱通知、页面设置等）导出成 JSON；「恢复配置」用该文件回灌，同名配置项被覆盖。不含文件记录、存储渠道与 API Token。' },
        { t: '自动双写', d: '设置好备份渠道后，新上传的文件会自动异步写入备份渠道。' },
        { t: '一键备份所选', d: '入口在「文件管理」右上角的批量操作：勾选文件后点「一键备份所选」，系统会检测哪些文件还没有备份，仅对未备份的补备份，并返回成功/失败/跳过数量。' },
        { t: '备份标识', d: '卡片视图左上角、列表视图「备份渠道」列都会展示已备份的渠道；文件详情里点击渠道可打开该文件在该渠道上的直链。' }
      ]
    },
    {
      id: 'manager',
      title: '七、文件管理',
      items: [
        {
          t: '搜索语法',
          sub: [
            '普通关键词：按文件名 / File_ID 模糊匹配',
            '#标签：包含该标签，如 #风景',
            '-#标签：排除该标签，如 -#原神',
            '可组合使用：风景 #山 -#水'
          ]
        },
        { t: '筛选弹窗（v2.8.7）', d: '右上角筛选按钮改为弹窗，内含四个标签页：「常规」= 原有全部条件（访问状态 / 黑白名单 / 审查结果 / 文件类型 / 备份状态 / 重定向 / 渠道类型 / 渠道名称 / 上传方式）；「标签」= 有无标签 + 具体标签多选（多选时可选「任一命中 / 全部命中」）；「日期」= 今天 / 昨天 / 前天 / 本周内 / 上周内 / 本月内 / 本年内快捷选项 + 日历自选范围；「大小」= 小于100K / 1M / 10M / 100M、大于100M 快捷选项 + 自定义最小/最大值。弹窗固定为视口高度的 96% 且水平垂直居中，切换标签页不跳动；任一标签页有值时，筛选按钮显示角标、对应标签名上显示小圆点提示。所有条件与搜索框、搜索范围、用户筛选、回收站状态一起提交后端联合查询（回收站内同样生效）。顶栏原先独立的「标签」按钮已移除，标签筛选统一在弹窗「标签」页操作（v2.8.7c）。' },
        { t: '视频静音开关（v2.8.7）', d: '右上角「回收站」旁新增声音按钮：默认静音（喇叭斜杠图标），此时预览浮层与文件详情页的视频都不出声；点击切换为有声（喇叭图标），两处视频即可播放声音。视频始终先以静音快速起播、再按开关设置声音（避免有声模式下浏览器拦截自动播放导致画面长时间出不来）；关闭文件详情弹窗或预览浮层消失时，正在播放的视频 / 音频会被彻底停止（媒体元素随弹窗关闭直接销毁，不会被后台缓冲或页面操作重新拉起；再次打开详情页会重新加载并起播，v2.8.7c）。开关状态跨页面记忆。' },
        { t: '防重复上传（v2.8.7）', d: '大文件「正在合并」期间若遇到网络异常 / 页面误判失败，自动重试不再产生重复文件：合并接口幂等（已完成会话直接返回上次结果），已上传成功的文件再次提交会被拦截并提示「此前已上传成功」。「正在合并」提示也不再重复叠加。' },
        { t: '移动端文件管理（v2.8.7）', d: '列表视图在存储渠道简称后显示文件大小；批量选择 / 视图切换 / 排序那一行改为单行左右滑动；文件夹卡片悬浮层不再显示删除按钮（删除走批量操作栏）。' },
        { t: '排序', d: '按上传时间、文件大小、原始文件名、显示文件名，以及按访问次数。' },
        { t: '访问次数', d: '外链每次被真实访问（下发文件）都会累计一次；管理后台预览不计入，避免刷新后台刷爆计数。卡片视图悬浮可见，列表视图有独立列。' },
        { t: '预览小眼睛（v2.8.6）', d: '图片 / 视频卡片第三行左侧的小眼睛：PC 鼠标悬停即弹出大图预览，移动端长按小眼睛弹出（居中显示，松手收起）；列表视图在移动端长按缩略图同样弹出预览。' },
        { t: '回收站（v2.8.6）', d: '回收站顶部提示条明确「这里的文件可进一步恢复或彻底删除(不可逆)」，并以醒目底色标出。' },
        { t: '文件名显示（v2.8.6）', d: '卡片 / 列表 / 历史记录 / 公开浏览统一「开头…结尾」中间省略：任何宽度下都保留头部与尾部（含扩展名）。' },
        { t: '视图与批量操作', d: '卡片 / 列表两种视图；批量复制链接、下载（打包 zip）、移动、打标签、加黑/白名单、删除，以及一键备份所选。' }
      ]
    },
    {
      id: 'history',
      title: '八、历史记录与系统状态',
      items: [
        { t: '历史记录', d: '上传页右上角「更多」→ 历史记录；文件管理右上角也有「历史记录」入口。记录保存在本机浏览器（localStorage），可切换网格/列表视图、复制链接、删除单条或清空全部。' },
        { t: '系统状态', d: '展示文件总数、上传渠道分布、上传方式分布、上传用户分布、上传类型分布与文件状态分布；上传趋势可按「渠道类型 / 渠道名称 / 用户 / 上传方式 / 类型」五个维度切换，并支持自选日期区间。「最近上传」列出最近 20 条记录，上方是今日 / 昨日 / 本周 / 本月 / 本年上传数量、累计占用空间与文件夹数量统计（点击上传数量可跳到历史记录）。' },
        { t: '上传方式（v2.8.6）', d: '每个文件都会记录是从哪个入口传上来的：Default = v2.8.6 之前的历史网页上传；Upload = 上传页「文件」模式；Fetch = 上传页「链接」模式转存；WebDAV / API-Web / API-S3 = 对外通道。文件详情页的「上传方式」字段、文件管理的筛选与系统状态的上传方式分布用的都是这份取值。' },
        { t: '系统日志', d: '记录写操作（上传 / 保存 / 删除）与 4xx、5xx、慢请求；支持按级别、作用域、关键词过滤与导出。' },
        { t: '移动端（v2.8.6）', d: '上传趋势的分组标签一屏放不下时改为左右滑动；历史记录 / 访问记录顶部的搜索与筛选栏随页面滚动，不再常驻占半屏。' },
        { t: '访问记录时间筛选（v2.8.8）', d: '手机上原来的双月份区间选择器必然溢出屏幕，现改为「按钮 + 单个月份面板」弹窗（与「系统状态 → 趋势预览」用同一个日历面板）；已选区间时按钮高亮并显示起止日期，右侧小叉可一键清空回到「全部时间」。桌面端仍是原来的双日期选择器。' }
      ]
    },
    {
      id: 'security',
      title: '九、安全与访问控制',
      items: [
        { t: '双重认证', d: '用户端与管理端可分别设置访问密码；开启后需要登录才能上传 / 进入后台。' },
        { t: '白名单模式', d: '开启后只有白名单文件可被访问，其余请求返回白名单提示图。' },
        { t: '放行地址（来源域名）', d: '一行一条「域名:端口」，如 192.168.1.3:5505、img.example.com:8443。按访问来源的域名 + 端口精确匹配，路径与参数不参与；同域不同端口视为不同来源；直接粘贴完整地址会自动截取域名部分。' },
        { t: '图片审查与 IP 查询', d: '上传时自动调用配置的审查渠道给出标签，可据此屏蔽不通过的图片。' },
        { t: 'API Token', d: '为脚本 / 第三方程序签发带权限与有效期的 Token，可随时吊销。支持「S3 协议」与「Web 通用」两种接入方式。' },
        { t: 'Web 通用接入的 compress 参数', d: '在自定义 Body 里带 compress=true 或 1 才会压缩（图片走 sharp、视频/音频走 ffmpeg，gif 自动跳过）；不传则原样上传，不受后台「默认开启压缩」影响。compressPercent 可选，指定压到原体积的百分比（10-100）。' }
      ]
    },
    {
      id: 'structure',
      title: '十一、代码结构说明',
      intro: '前后端分离：后端 NestJS + Prisma + SQLite，前端 Vue3 + Vite + Element Plus。下面按目录说明各自职责。',
      items: [
        { t: 'backend/src/main.ts', d: '应用入口：注册全局中间件、静态资源与外链路由（/file、/dav）、启动 HTTP 服务（默认端口 3618）。' },
        { t: 'backend/src/app.module.ts', d: '模块装配：把各控制器与服务注册进 Nest 容器，统一挂在 /api 前缀下。' },
        { t: 'backend/src/upload/', d: '上传核心。upload.controller.ts 负责 HTTP 契约（/upload、/api/fetchRes、分块上传）；upload.service.ts 负责渠道解析、去重、压缩、主渠道上传、备份与落库。' },
        { t: 'backend/src/adapters/', d: '存储适配器（策略模式）：adapter.factory.ts 按渠道类型创建实例，每个适配器实现 upload / delete / buildDirectUrl 三个方法。新增渠道类型只需加一个适配器并在工厂注册。' },
        { t: 'backend/src/channels/', d: '渠道管理：渠道增删改查、密钥加解密（CryptoService）、连接测试、容量统计、主/备渠道唯一性约束，以及编辑弹窗用的密钥明文回填接口（GET /api/manage/channels/:id/plain）。' },
        { t: 'backend/src/files/', d: '文件管理与外链分发：列表查询（筛选/搜索类型/排序/分页）、详情、删除、批量操作、重定向、一键备份、系统日志与系统状态统计；LinkController 负责外链（黑白名单 / 白名单模式 / 域名过滤 → 代理或 302，代理支持 Range，图片尺寸处理缩放）。' },
        { t: 'backend/src/users/', d: '用户管理：账户增删改、权限（可编辑/可删除/启用）、按用户账户或按 IP 归集；内建管理员不在 users 表，其昵称/渠道/强制限制存于管理员档案（sysConfig:adminProfile）。' },
        { t: 'backend/src/tokens/', d: 'API Token：S3 与 Web 两种类型的签发、鉴权与访问日志（token-api.controller.ts）。' },
        { t: 'backend/src/webdav/', d: '对外 WebDAV：把图床挂成网盘，支持 OPTIONS / PROPFIND / GET / PUT / MKCOL / DELETE，配置存于系统管理 → 其他设置。' },
        { t: 'backend/src/settings/', d: '设置中心。sysconfig.service.ts 按分区（page / security / upload / others / ai）整段读写配置；settings.service.ts 提供 key-value 读写与内存缓存。' },
        { t: 'backend/src/auth/', d: '认证与会话：统一账户校验（超管 → users 表 → 安全设置 → 环境变量）、HttpOnly Cookie 会话、三种路由守卫。' },
        { t: 'backend/src/common/', d: '公共设施：Prisma 客户端、日志中心（app-log.ts，保留 7 天）、访问控制与文件视图序列化（file-view.ts）、请求限流。' },
        { t: 'frontend/src/views/', d: '页面：UploadHome（上传页）、AdminDashBoard（文件管理）、CustomerConfig（用户管理）、SystemConfig（系统管理）、HistoryPage（历史记录）、Login / SuperAdmin、PublicBrowse（公开画廊）、DocsPage（本文档）。' },
        { t: 'frontend/src/components/upload/', d: '上传页组件：UploadForm（上传逻辑与文件列表）、UploadFileItem、UploadSettingsDialog（上传设置）。' },
        { t: 'frontend/src/components/config/', d: '系统管理各分区：SysCogStatus（系统状态）、SysCogUpload（存储渠道）、SysCogSecurity（安全设置 / API Token）、SysCogLog（系统日志）、SysCogOthers（其他设置，含对外 WebDAV）、SysCogPage、SysCogAI。' },
        { t: 'frontend/src/utils/', d: '工具：fileManager（列表请求参数拼装）、clipboard（剪贴板兼容层）、fetchWithAuth（带会话的请求）、upload/urlBuilder（四种外链格式生成）。' }
      ]
    },
    {
      id: 'roadmap',
      title: '十二、开发大纲',
      intro: '需要二次开发时，建议按下面的顺序阅读与改动。',
      items: [
        { t: '第一步：先跑起来', d: '后端 npm run start:dev，前端 npm run dev（Vite 把 /api、/upload 代理到 3618）。先确认能上传一张图并拿到可访问外链。' },
        { t: '第二步：理解一次上传', d: '从 POST /upload 进入，读 upload.controller.ts → upload.service.ts 的 upload()：渠道解析 → 去重 → 压缩 → 主渠道上传 → 备份 → 写 FileRecord / FileCopy。' },
        { t: '第三步：新增存储渠道', d: '在 backend/src/adapters/ 加适配器 → adapter.factory.ts 注册 → frontend/src/components/config/channel-schema.js 加配置字段与展示名 → SysCogUpload.vue 的 CHANNEL_TYPES 加类型。' },
        { t: '第四步：新增后台设置项', d: '后台设置走「分区 JSON」：在 sysconfig.service.ts 的 defaults(section) 补默认值，前端对应的 SysCog*.vue 直接读写该分区，无需改数据库。' },
        { t: '第五步：改数据库结构', d: '改 backend/prisma/schema.prisma → npx prisma db push → npx prisma generate，然后重启后端。' },
        { t: '第六步：新增页面', d: '在 frontend/src/views/ 新建页面 → router/index.js 注册路由并挂对应守卫（userAuthGuard / manageAuthGuard / adminAuthGuard / superAuthGuard）。' },
        { t: '约定（重要）', d: '渠道类型、角色、配置项的前后端字段名必须保持一致；渠道展示名要同时维护 backend/src/common/file-view.ts 的 CHANNEL_LABEL 与 frontend/src/components/config/channel-schema.js 的 CHANNEL_SHORT_LABEL。' }
      ]
    },
    {
      id: 'deploy',
      title: '十三、部署方法',
      intro: '推荐 Docker 部署；也可以不用容器，直接用 Node 运行。',
      items: [
        {
          t: '方式一：Docker Compose（推荐）',
          sub: [
            '复制 .env.example 为 .env，至少修改 CONFIG_SECRET（渠道密钥加密主密钥，改动后已保存的渠道密钥需重新填写）',
            '按需填写 ADMIN_USER / ADMIN_PASSWORD（初始管理员账号）',
            '可选：填写 SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD 开启超级管理员（用于找回管理员密码）',
            '执行 docker compose up -d --build',
            '浏览器打开 http://服务器IP:3618，用管理员账号登录后台'
          ]
        },
        {
          t: '方式二：不使用 Docker',
          sub: [
            '安装 Node.js 18+（推荐 20 / 22）',
            '后端：cd backend && npm install && npx prisma db push && npm run build && node dist/main.js',
            '前端：cd frontend && npm install && npm run build（产物输出到项目根目录 frontend-dist）',
            '生产环境用 pm2 / systemd 常驻后端进程，并用 Nginx 托管前端静态产物、反代 /api、/upload、/file、/dav',
            '端口默认 3618，可用环境变量 PORT 覆盖'
          ]
        },
        { t: '必须持久化的内容', d: 'backend/data（SQLite 数据库）、backend/logs（日志，仅自动保留最近 7 天）。容器部署时对应挂载 ./data 卷。' },
        { t: '升级', d: 'Docker：docker compose pull 后 docker compose up -d --build；非 Docker：重新 build 后端并重启进程，前端重新 build 后覆盖静态目录。' },
        { t: '反向代理要点', d: '需要透传 Host、X-Forwarded-For、X-Forwarded-Proto；WebDAV 需要放行 PROPFIND / MKCOL / PUT 等非标准方法（Nginx 默认允许，部分云网关需显式声明）。' }
      ]
    },
    {
      id: 'accounts',
      title: '十四、初始账户与权限',
      intro: '系统有三类账户，登录入口统一为「用户名 + 密码」。',
      items: [
        { t: '管理员（admin）', d: '首次部署的兜底账号来自环境变量 ADMIN_USER / ADMIN_PASSWORD（默认 admin / go-imgbed）。登录后可访问「用户管理」与「系统管理」的全部功能。为避免被猜解，部署后请立即修改密码。' },
        { t: '超级管理员（super）', d: '仅由环境变量 SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD 定义，默认关闭。用途是「初始管理员密码遗忘后找回」：用超管登录后只能重置管理员的用户名 / 密码，后台无法查看、修改或删除该账户。' },
        { t: '普通用户（user）', d: '由管理员在「用户管理」中创建。只能上传文件、访问自己的文件与文件夹、查看自己的历史记录；没有用户管理与系统管理入口。管理员可为其设置是否允许编辑 / 删除、是否禁用账户，以及该账户的主 / 备存储渠道。' },
        { t: '设置优先级', d: '上传相关设置：前端上传设置 > 用户管理（账户级渠道）> 后台全局默认，逐级回退。' },
        { t: '安全建议', d: '生产环境务必修改 CONFIG_SECRET；启用 HTTPS 并开启会话安全 Cookie；定期清理不再使用的 API Token；不要把数据库文件暴露到公网。' }
      ]
    },
    {
      id: 'faq',
      title: '十五、常见问题',
      items: [
        { t: '粘贴 URL 提示「请求失败」？', d: '确认该 URL 可被服务器访问（不要指向需要登录的私有地址）；本站对 localhost 与内网地址是放行的，但仍需目标服务能正常响应。' },
        { t: '外链 404？', d: '检查文件是否被删除、是否属于黑名单，以及渠道配置（域名、桶权限、WebDAV 路径）是否正确。' },
        { t: '带扩展名访问会不会出问题？', d: '不会。扩展名只用于直观展示类型；代理、302、访问源切换都按 File_ID 处理。' },
        { t: '上传很慢？', d: '主渠道是同步上传；可把主渠道换成带宽更好的渠道，或用备份渠道分担。大文件建议使用对象存储渠道（COS / MinIO / R2 / S3）。' }
      ]
    }
  ]
};

const EN = {
  title: 'Documentation',
  subtitle: 'Everything about uploading, links, storage channels, dedup and backups',
  toc: 'Contents',
  backHome: 'Back to upload page',
  footer: 'This documentation ships with the system and matches the current version behaviour.',
  sections: [
    {
      id: 'quickstart',
      title: '1. Quick Start',
      intro: 'Three upload modes are available. The second button at the top-right switches between "file upload" and "clipboard upload".',
      items: [
        { t: 'File upload', d: 'Click or drag files into the drop area (multi-select). You can also pick a whole folder; the relative directory structure is preserved. Fill the folder input on top to target a directory, leave empty for root.' },
        { t: 'Clipboard upload', d: 'Switch to clipboard mode, then paste an image/file or one or more URLs.' },
        { t: 'Transfer (URL upload)', d: '"Transfer" makes the server fetch the URL and re-upload it through the current channel, returning a local link. "External" only registers the link without storing the file.' },
        { t: 'Naming (v2.8.8)', d: 'No longer offered in the upload settings — every upload follows Settings → Others → Upload-related config → Default naming, so the same account gets consistent file names everywhere.' },
        { t: 'Register File (v2.8.8)', d: 'A button right above "Upload settings" in the bottom-right quick toolbar, and another one next to "New folder" in the admin file manager. Use it to register a file that already lives on object storage or another image host: fill in the source URL, an optional name, channel, folder and note; type / size / MD5 are probed from the URL, upload time is the moment you submit, upload source is recorded as Record, and tags (year / extension / channel / type / Record) are added automatically. Nothing is uploaded again. Deleting a registered record removes the record only — the source file stays untouched.' },
        { t: 'Per-account transcode policy (v2.8.8)', d: 'In User management → edit → Admin actions you can set, per account: follow global / disabled / enabled / let the user decide. With "let the user decide", that account sees the same dropdown in Upload settings → File preprocessing (follow global / disabled / enabled) and it resets to "follow global" on every refresh. The policy applies to all upload entry points of the account (home page, link transfer, WebDAV, API-S3, API-Web).' },
        { t: 'Per-account file size limit (v2.8.8)', d: 'Set it in User management → edit → Admin actions; empty or 0 means the global limit. It applies to every upload entry point of that account, and the error message says whether the account or the global limit was hit. The old "type and size limits" switch has been removed.' },
        { t: 'Excluded compression formats', d: 'Sits right after File compression → Compression target (%): formats in this list skip compression and upload as-is (e.g. add mp4 to stop compressing video). Leave empty to exclude nothing — every compressible type follows the compression rules. Built-in compressible list: jpg/jpeg/jfif/png/webp/avif, mp4/webm/mov/m4v/mkv, mp3/m4a/aac/wav/flac/ogg/opus.' },
        { t: 'Size guarantee', d: 'If compression/re-encoding does not make the file smaller (equal or larger than the original), the result is discarded and the original is uploaded — never "compressed" into a bigger file. The only exception is video compatibility transcode: H.265/HEVC → H.264 is kept even when larger so browsers can play it, and the size change is written to the system log.' },
        { t: 'Video compatibility transcode', d: 'Settings → Others → Upload-related config → Video compatibility transcode: H.265/HEVC, ProRes and other browser-unfriendly codecs are transcoded to H.264 on the server (ffmpeg required). H.264/AV1/VP9 files pass through; independent of the compression switch.' },
        { t: 'Post-processing (major change in v2.8.8)', d: 'Compression and compatibility transcode for video / audio no longer run inside the upload request. Once the file is stored and the channel write succeeds the link is returned immediately, and compression / transcode run in a single background queue (at most one ffmpeg process at a time). Order is always compress first, then transcode — compression uses libx264 so its output is already H.264 and a successful compression skips transcoding entirely.' },
        { t: 'When post-processing gives up', d: 'Upload success always wins: (1) estimated time above 5 minutes (MEDIA_POST_MAX_SECONDS) → give up; (2) fewer than 2 CPU cores, 1-minute load above cores x1.5, or under 256MB free memory → skip; (3) compression is predicted to fail → give up on both; (4) compression succeeded but transcode is predicted to fail → keep the compressed file, drop the transcode; (5) execution timeout → give up. On any give-up the original object and record stay as uploaded, links keep working, and the reason is written to the system log.' },
        { t: 'WebP Conversion / File Compression are master switches (v2.8.8)', d: 'Both items in Settings → Others → Upload-related config were upgraded from "defaults" to master switches. Turning WebP Conversion off hides the Convert to WebP button in the upload list toolbar. Turning File Compression off hides the File Compression toolbar button and every compression option in the upload settings dialog, and also hides "Min compress threshold" / "Default compress target" in the admin — values are kept and come back when re-enabled.' },
        { t: 'Auto retry moved (v2.8.8)', d: 'The Auto retry switch from the upload settings now lives in Settings → Others → Upload-related config → Auto retry (the row right above Video compatibility transcode). It is stored in the database, applies to every account, and is no longer shown on the upload page.' }
      ]
    },
    {
      id: 'url',
      title: '2. Link Formats',
      intro: 'Four formats are generated for every file; the default one is used when copying.',
      items: [
        { t: 'Raw URL', d: 'e.g. https://your-domain/file/<File_ID>.jpg — the trailing extension is only a visual hint; the link also works without it.' },
        { t: 'Markdown', d: '![filename](url)' },
        { t: 'HTML', d: '<img src="url" alt="filename">' },
        { t: 'BBCode', d: '[img]url[/img]' },
        { t: 'Custom URL prefix', d: 'For CDN acceleration. Make sure the custom prefix is reachable.' },
        { t: 'About the extension', d: 'The backend strips the last extension when looking up the record, so both forms work and neither affects proxy forwarding, 302 redirects or access-source switching.' }
      ]
    },
    {
      id: 'channels',
      title: '3. Storage Channels',
      intro: 'Manage channels in Settings → Upload Settings. Nine types are supported.',
      items: [
        {
          t: 'Channel types',
          sub: [
            'Dedicated (own adapter): Tencent COS, MinIO, Cloudflare R2, S3-compatible, WebDAV, Immich',
            'Generic (shares the generic HTTP adapter with the Custom Web channel): EasyImages, Lsky Pro, Custom Web'
          ]
        },
        { t: 'Custom Web channel', d: 'Only three things are required: upload endpoint, file form field name and response URL path. Use the custom headers / extra form fields JSON for auth or extra params. Legacy token/headers/extraFields fields are still accepted.' },
        { t: 'Main & backup channel', d: 'The main channel uploads synchronously (drives latency); the backup channel is written asynchronously and never blocks the response. Each channel can be enabled independently.' },
        { t: 'Disabled channels (v2.8.6)', d: 'Turning a channel off removes it from every channel dropdown / picker (upload settings, tokens, user management, status page) and it no longer accepts uploads from any source: web, WebDAV or API requests that name it explicitly get a clear "channel disabled" error instead of silently landing on another channel.' },
        { t: 'Public / internal domain (v2.8.7)', d: 'Channel domain fields are now uniformly labeled "public access domain". EasyImages, Lsky, Immich, MinIO, S3, WebDAV and custom Web channels also support an optional "internal communication domain": set it to a container IP or container name and every internal file load (file manager, detail, history, public gallery, proxy fetching for issued links) prefers the internal address - faster and saves public traffic; falls back to the public domain, then the endpoint. The detail page "storage / backup channel" source links always use the public domain, and 302 redirect mode also uses the public domain.' },
        { t: 'Quota', d: 'Enable the quota switch to reveal the limit and alert threshold. Channels above the threshold stop receiving new uploads.' },
        { t: 'Test connection', d: 'Use "Test connection" when adding or editing a channel; a successful test returns a clickable direct link.' },
        {
          t: 'LAN / internal addresses (faster uploads)',
          sub: [
            'Channel addresses (Endpoint / service URL / upload endpoint) accept a LAN IP or a Docker container name, e.g. minio:9000, immich:2283, lsky:8080, 192.168.1.10:9000, nas.local.',
            'Typical setup: go-imgbed and MinIO / Immich / Lsky / WebDAV run on the same NAS and the same Docker network — internal traffic skips the public internet and any CDN, so uploads are noticeably faster.',
            'When the protocol is omitted it is inferred: internal hosts and container names get http, public domains get https (self-hosted services usually have no TLS, so blindly forcing https would fail).',
            'All channel traffic is initiated by the server (the backend PUTs/POSTs the file); the browser only submits the config. So the imgbed being served over https does not prevent talking to http://minio:9000 internally, and mixed-content blocking does not apply.',
            'Reads can go internal too: the public/access domain is the domain prefix of the outbound link, and what it should be depends on the delivery mode. In proxy mode (default) the server fetches the bytes, so you may put an internal address there for the fastest read+write path while visitors still see the imgbed domain. In 302 redirect mode the visitor browser opens that address directly, so it must be publicly reachable.'
          ]
        }
      ]
    },
    {
      id: 'deliver',
      title: '4. Link Delivery (proxy / 302)',
      items: [
        { t: 'Proxy mode (default)', d: 'The server fetches upstream bytes and forwards them. Links stay stable, Range requests work, and failures degrade to the other channel automatically.' },
        { t: '302 redirect', d: 'The browser hits the upstream storage directly — minimal server traffic.' },
        { t: 'Current access source', d: 'Switch between main and backup channel with one click; it applies to all existing links immediately.' },
        { t: 'Proxy parameters', d: 'Tune the upstream timeout and client cache duration (0 disables caching).' }
      ]
    },
    {
      id: 'dedup',
      title: '5. Deduplication (instant upload)',
      items: [
        { t: 'Rule', d: 'MD5 and size are computed from the ORIGINAL file before compression, then looked up right away: same MD5 and same size means duplicate — the existing link is returned without review, compression, transcoding or upload.' },
        { t: 'Why the original size', d: 'The compressed byte count of the same source file is not stable across quality settings (JPEG re-encoding, ffmpeg transcoding both vary). Comparing post-compression sizes makes the same file look like a new one, so the original size + original MD5 are used.' },
        { t: 'MD5 semantics', d: 'The MD5 stored on a record is the MD5 of the original file content, so older as-is uploads still match. Legacy rows without an original size fall back to the current size.' },
        { t: 'Scope: across all channels', d: 'Same MD5 + same size means duplicate (default, saves the most space).' },
        { t: 'Scope: same channel type (v2.8.7b)', d: 'Compares channel type first, then size + MD5 — dedupes among channels of the same type (e.g. multiple S3 channels), while different types each keep a copy.' },
        { t: 'Scope: same channel name (v2.8.7b)', d: 'Compares channel name first, then size + MD5: the same file can live in different channels (channels sharing a name still dedupe).' },
        { t: 'Toggle', d: 'The dedup switch and scope live in the storage/distribution settings; turn it off to always upload for real.' }
      ]
    },
    {
      id: 'backup',
      title: '6. Backups & Config Backup',
      items: [
        { t: 'Config backup / restore', d: 'On the System Status page, "Config Backup" exports the settings sections (page / security / others / AI, including whitelist, mail and page settings) as JSON; "Restore Config" writes it back, overwriting items with the same key. File records, storage channels and API tokens are not included.' },
        { t: 'Automatic mirroring', d: 'With a backup channel configured, every new upload is mirrored asynchronously.' },
        { t: 'Backup selected', d: 'Open File Management and use the batch action "Backup selected". The system detects which files lack a backup and only backs those up, reporting success / failed / skipped.' },
        { t: 'Backup badges', d: 'Card view shows backup channels next to the channel badge; list view has a dedicated "Backup Channel" column. In file details you can click a channel to open that file on that channel.' }
      ]
    },
    {
      id: 'manager',
      title: '7. File Management',
      items: [
        {
          t: 'Search syntax',
          sub: [
            'Plain keyword: fuzzy match on file name / File_ID',
            '#tag: include tag',
            '-#tag: exclude tag',
            'Combine freely: landscape #mountain -#water'
          ]
        },
        { t: 'Filter dialog (v2.8.7)', d: 'The filter button now opens a dialog with four tabs: "General" (all original conditions: access status, black/white list, review result, file type, backup status, redirect, channel type / name, upload method), "Tags" (tag presence plus multi-select specific tags with any/all match), "Date" (quick picks: today / yesterday / day before yesterday / this week / last week / this month / this year, plus a calendar range), and "Size" (<100K / <1M / <10M / <100M / >100M quick picks plus custom min/max). The dialog is fixed at 96% of the viewport height, centered both ways, with no jump when switching tabs; any tab with values shows a badge on the button and a dot on the tab label. All conditions combine with the search box, search scope, user filter and trash state into one backend query (also effective inside the trash). The former standalone tag button in the toolbar has been removed — tag filtering now lives in the Tags tab of the dialog (v2.8.7c).' },
        { t: 'Video mute toggle (v2.8.7)', d: 'A sound button next to the trash button: muted by default (hover preview and file detail videos stay silent); click to enable sound. Videos always start muted for instant playback and then follow the toggle (browsers block unmuted autoplay, which previously stalled the picture); closing the detail dialog or dismissing the hover preview stops any playing video/audio for good — the media elements are destroyed on close and cannot be revived by background buffering or page updates; reopening the dialog reloads and replays (v2.8.7c). The choice is remembered across pages.' },
        { t: 'Duplicate-upload guard (v2.8.7)', d: 'Retrying after a network hiccup during "merging" no longer creates duplicate files: the merge endpoint is idempotent (a completed session returns the previous result) and re-submitting an already-uploaded file is blocked with a clear notice. The "merging" toast no longer stacks.' },
        { t: 'Mobile file manager (v2.8.7)', d: 'List view shows the file size next to the channel badge; the checkbox / view / sort row becomes a single horizontally scrollable line; the folder card hover layer no longer shows a delete button (use the batch action bar).' },
        { t: 'Sorting', d: 'By upload time, file size, raw name, display name, and by view count.' },
        { t: 'View count', d: 'Incremented on every real external access; admin previews are excluded so refreshing the console does not inflate it. Hover a card to see it, or check the list column.' },
        { t: 'Preview eye (v2.8.6)', d: 'The eye icon on the left of a card\'s third row: hover on PC to preview the full image/video; long-press on mobile to preview (centered, release to close). In list view, long-press the thumbnail on mobile for the same preview.' },
        { t: 'Trash (v2.8.6)', d: 'The trash banner clearly states files can be restored or permanently deleted (irreversible), highlighted with a stronger background.' },
        { t: 'File names (v2.8.6)', d: 'Cards / list / history / public pages all use the same middle-ellipsis: head and tail (with extension) are always kept.' },
        { t: 'Views & batch actions', d: 'Card / list views; batch copy links, download as zip, move, tag, block/whitelist, delete, and backup selected.' }
      ]
    },
    {
      id: 'history',
      title: '8. History & Status',
      items: [
        { t: 'History', d: 'Top-right "More" → History on the upload page; File Management also has a History button. Records live in the local browser (localStorage) and can be viewed as grid/list, copied, deleted individually or cleared.' },
        { t: 'System status', d: 'File totals plus channel, upload method, user, file type and status distributions. The upload trend can be grouped by channel type, channel name, user, upload method and file type, with a selectable date range. "Recent uploads" lists the latest 20 records, followed by today / yesterday / week / month / year counts, total space used and folder count (click a count to open History).' },
        { t: 'Upload method (v2.8.6)', d: 'Every file records the entry it came from: Default = legacy web uploads before v2.8.6; Upload = the upload page in "file" mode; Fetch = the upload page in "link" mode (saved from URL); WebDAV / API-Web / API-S3 = external channels. The file detail "upload method" field, the file manager filter and the status page distribution all use these values.' },
        { t: 'Logs', d: 'Records writes (upload / save / delete) plus 4xx, 5xx and slow requests, with level/scope/keyword filters and export.' },
        { t: 'Mobile (v2.8.6)', d: 'Upload trend tabs scroll horizontally when they overflow; History / Access log top bars scroll away with the page instead of staying pinned.' },
        { t: 'Access log date filter (v2.8.8)', d: 'On phones the two-month range picker always overflowed the screen, so it is now a button that opens a single-month panel (the same calendar used by Status → Trend preview). With a range selected the button is highlighted and shows the start/end dates, and the small cross on the right clears it back to "all time". Desktop keeps the original range picker.' }
      ]
    },
    {
      id: 'security',
      title: '9. Security',
      items: [
        { t: 'Two auth layers', d: 'Separate passwords for the user side and the admin console.' },
        { t: 'Whitelist mode', d: 'Only whitelisted files stay reachable; other requests get the whitelist notice image.' },
        { t: 'Allowed source hosts', d: 'One "host:port" per line, e.g. 192.168.1.3:5505 or img.example.com:8443. Matching is exact on the source host + port; paths and query strings are ignored, and the same host on another port counts as a different source. Pasting a full URL works too — only the host part is kept.' },
        { t: 'Image review & IP lookup', d: 'Optional review provider tags uploads so you can block rejected content.' },
        { t: 'API tokens', d: 'Issue scoped, expiring tokens for scripts and third-party tools; revoke any time. Both "S3 protocol" and "Web generic" access are supported.' },
        { t: 'compress field (Web generic)', d: 'Send compress=true or 1 in the custom Body to compress (images via sharp, video/audio via ffmpeg, GIF skipped); omit it to upload as-is — the global "default compression" setting does not apply to this channel. compressPercent optionally sets the target size (10-100 % of the original).' }
      ]
    },
    {
      id: 'structure',
      title: '11. Code Structure',
      intro: 'Frontend and backend are separated: NestJS + Prisma + SQLite on the server, Vue3 + Vite + Element Plus on the client.',
      items: [
        { t: 'backend/src/main.ts', d: 'Entry point: global middleware, static assets and link routes (/file, /dav), HTTP server on port 3618.' },
        { t: 'backend/src/app.module.ts', d: 'Module wiring: registers every controller/service into the Nest container under the /api prefix.' },
        { t: 'backend/src/upload/', d: 'Upload core. upload.controller.ts implements the HTTP contract (/upload, /api/fetchRes, chunked upload); upload.service.ts handles channel resolution, dedup, compression, primary upload, backup and persistence.' },
        { t: 'backend/src/adapters/', d: 'Storage adapters (strategy pattern): adapter.factory.ts creates an instance per channel type; each adapter implements upload / delete / buildDirectUrl. Adding a channel type means adding one adapter and registering it in the factory.' },
        { t: 'backend/src/channels/', d: 'Channel management: CRUD, secret encryption (CryptoService), connection test, quota stats, main/backup uniqueness, plus the plaintext refill endpoint used by the edit dialog (GET /api/manage/channels/:id/plain).' },
        { t: 'backend/src/files/', d: 'File management and link distribution: list query (filters / search type / sort / paging), detail, delete, batch actions, redirect, backup-all, system logs and status statistics; LinkController serves external links (white/black lists, whitelist mode, domain filter → proxy or 302; proxy supports Range and image resizing).' },
        { t: 'backend/src/users/', d: 'User management: account CRUD, permissions (editable / deletable / enabled), grouping by account or by IP; the built-in admin is not in the users table — its nickname / channels / enforcement live in the admin profile (sysConfig:adminProfile).' },
        { t: 'backend/src/tokens/', d: 'API tokens: issuing and authorising S3 and Web tokens (token-api.controller.ts).' },
        { t: 'backend/src/webdav/', d: 'External WebDAV: mounts the image bed as a network drive (OPTIONS / PROPFIND / GET / PUT / MKCOL / DELETE); configured under Settings → Others.' },
        { t: 'backend/src/settings/', d: 'Settings centre. sysconfig.service.ts reads/writes whole config sections (page / security / upload / others / ai); settings.service.ts provides key-value access with an in-memory cache.' },
        { t: 'backend/src/auth/', d: 'Authentication: unified account check (super → users table → security settings → env vars), HttpOnly cookie sessions, three route guards.' },
        { t: 'backend/src/common/', d: 'Shared utilities: Prisma client, log centre (app-log.ts, 7-day retention), access control and file view serialisation (file-view.ts), rate limiting.' },
        { t: 'frontend/src/views/', d: 'Pages: UploadHome, AdminDashBoard, CustomerConfig (users), SystemConfig, HistoryPage, Login / SuperAdmin, PublicBrowse, DocsPage.' },
        { t: 'frontend/src/components/upload/', d: 'Upload page components: UploadForm, UploadFileItem, UploadSettingsDialog.' },
        { t: 'frontend/src/components/config/', d: 'Settings sections: SysCogStatus, SysCogUpload (channels), SysCogSecurity (security / tokens), SysCogLog, SysCogOthers (includes WebDAV), SysCogPage, SysCogAI.' },
        { t: 'frontend/src/utils/', d: 'Utilities: fileManager (list query params), clipboard (compatibility layer), fetchWithAuth, upload/urlBuilder (link formats).' }
      ]
    },
    {
      id: 'roadmap',
      title: '12. Development Outline',
      intro: 'Suggested reading and change order for secondary development.',
      items: [
        { t: 'Step 1: run it', d: 'Backend: npm run start:dev. Frontend: npm run dev (Vite proxies /api and /upload to 3618). Verify you can upload and get a working link.' },
        { t: 'Step 2: understand one upload', d: 'Start from POST /upload, then follow upload.controller.ts → upload.service.ts upload(): channel resolution → dedup → compression → primary upload → backup → FileRecord / FileCopy.' },
        { t: 'Step 3: add a channel type', d: 'Add an adapter under backend/src/adapters/, register it in adapter.factory.ts, add config fields and labels in channel-schema.js, and add the type to CHANNEL_TYPES in SysCogUpload.vue.' },
        { t: 'Step 4: add a setting', d: 'Settings use section JSON: add defaults in sysconfig.service.ts defaults(section), then read/write it from the matching SysCog*.vue — no database change needed.' },
        { t: 'Step 5: change the schema', d: 'Edit backend/prisma/schema.prisma → npx prisma db push → npx prisma generate, then restart the backend.' },
        { t: 'Step 6: add a page', d: 'Create the page in frontend/src/views/, then register the route in router/index.js with the proper guard (userAuthGuard / manageAuthGuard / adminAuthGuard / superAuthGuard).' },
        { t: 'Convention (important)', d: 'Field names for channel types, roles and settings must stay identical across frontend and backend. Channel display names are duplicated in backend/src/common/file-view.ts (CHANNEL_LABEL) and frontend/src/components/config/channel-schema.js (CHANNEL_SHORT_LABEL).' }
      ]
    },
    {
      id: 'deploy',
      title: '13. Deployment',
      intro: 'Docker Compose is recommended, but plain Node works too.',
      items: [
        {
          t: 'Option A: Docker Compose (recommended)',
          sub: [
            'Copy .env.example to .env and at least change CONFIG_SECRET (channel secret master key)',
            'Optionally set ADMIN_USER / ADMIN_PASSWORD (initial admin account)',
            'Optionally set SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD to enable the super admin (password recovery)',
            'Run docker compose up -d --build',
            'Open http://server-ip:3618 and sign in with the admin account'
          ]
        },
        {
          t: 'Option B: without Docker',
          sub: [
            'Install Node.js 18+ (20 / 22 recommended)',
            'Backend: cd backend && npm install && npx prisma db push && npm run build && node dist/main.js',
            'Frontend: cd frontend && npm install && npm run build (output goes to frontend-dist in the project root)',
            'In production keep the backend alive with pm2 / systemd and serve the static build through Nginx, proxying /api, /upload, /file and /dav',
            'Default port is 3618, overridable with the PORT environment variable'
          ]
        },
        { t: 'Persist these', d: 'backend/data (SQLite database) and backend/logs (logs, automatically pruned to the last 7 days). Mount ./data when using Docker.' },
        { t: 'Upgrading', d: 'Docker: docker compose pull then docker compose up -d --build. Non-Docker: rebuild the backend and restart it, then rebuild the frontend and replace the static directory.' },
        { t: 'Reverse proxy notes', d: 'Forward Host, X-Forwarded-For and X-Forwarded-Proto. WebDAV needs non-standard methods (PROPFIND / MKCOL / PUT) to pass through — Nginx allows them by default, some cloud gateways need explicit rules.' }
      ]
    },
    {
      id: 'accounts',
      title: '14. Accounts & Permissions',
      intro: 'Three account roles exist; all sign in with username + password.',
      items: [
        { t: 'Administrator (admin)', d: 'The fallback account comes from ADMIN_USER / ADMIN_PASSWORD (default admin / go-imgbed). It can access all of User Management and System Settings. Change the password right after deployment.' },
        { t: 'Super administrator (super)', d: 'Defined only by SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD; disabled by default. Its purpose is recovering a forgotten admin password: after signing in it can only reset the admin username / password and is not visible in User Management.' },
        { t: 'Standard user (user)', d: 'Created by an administrator in User Management. Can upload files, see its own files/folders and its own history; no access to user or system management. The administrator can toggle edit/delete permission, disable the account and assign main/backup channels.' },
        { t: 'Settings precedence', d: 'Upload settings: frontend upload settings > account-level channels in User Management > global defaults, falling back step by step.' },
        { t: 'Security advice', d: 'Always change CONFIG_SECRET in production, enable HTTPS with secure session cookies, revoke unused API tokens and never expose the database file publicly.' }
      ]
    },
    {
      id: 'faq',
      title: '15. FAQ',
      items: [
        { t: '"Pasted URL request failed"?', d: 'Make sure the server can reach the URL (avoid login-protected private addresses). localhost and private ranges are allowed, but the target must respond.' },
        { t: 'Link returns 404?', d: 'Check whether the file was deleted or blacklisted, and whether the channel config (domain, bucket permissions, WebDAV path) is correct.' },
        { t: 'Does the extension break anything?', d: 'No — it is purely cosmetic. Proxy, 302 and access-source switching all work off the File_ID.' },
        { t: 'Uploads feel slow?', d: 'The main channel uploads synchronously. Prefer a faster channel, or offload via the backup channel. For large files use object storage (COS / MinIO / R2 / S3).' }
      ]
    }
  ]
};

export default {
  name: 'DocsPage',
  data() {
    return {
      // 当前阅读到的章节（用于左栏目录高亮）
      activeSection: '',
      tocObserver: null,
    };
  },
  computed: {
    isZh() {
      return String(this.$i18n.locale || 'zh-CN').startsWith('zh');
    },
    dict() {
      return this.isZh ? ZH : EN;
    },
    sections() {
      return this.dict.sections;
    }
  },
  watch: {
    // 中英切换后章节数量/顺序一致，重新建立观察器即可
    sections() {
      this.setupTocSpy();
    }
  },
  mounted() {
    this.setupTocSpy();
  },
  beforeUnmount() {
    if (this.tocObserver) {
      this.tocObserver.disconnect();
      this.tocObserver = null;
    }
  },
  methods: {
    t(key) {
      return this.dict[key];
    },
    toggleLocale() {
      setLocale(this.isZh ? 'en' : 'zh-CN');
    },
    /** 左栏目录跟随正文滚动高亮当前章节 */
    setupTocSpy() {
      if (this.tocObserver) {
        this.tocObserver.disconnect();
        this.tocObserver = null;
      }
      this.$nextTick(() => {
        const els = this.sections
          .map((s) => document.getElementById(s.id))
          .filter(Boolean);
        if (!els.length || typeof IntersectionObserver === 'undefined') return;
        this.tocObserver = new IntersectionObserver(
          (entries) => {
            const visible = entries
              .filter((e) => e.isIntersecting)
              .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
            if (visible.length) this.activeSection = visible[0].target.id;
          },
          { rootMargin: '-10% 0px -75% 0px', threshold: [0, 1] },
        );
        els.forEach((el) => this.tocObserver.observe(el));
      });
    },
    scrollTo(id) {
      const el = document.getElementById(id);
      if (el) {
        this.activeSection = id;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    goBack() {
      if (window.history.length > 1) {
        this.$router.back();
      } else {
        this.$router.push('/');
      }
    }
  }
};
</script>

<style scoped>
.docs-page {
  min-height: 100vh;
  background: var(--bg-color);
  color: var(--el-text-color-primary);
  padding: 28px 16px 60px;
  box-sizing: border-box;
}

.docs-container {
  max-width: 1100px;
  margin: 0 auto;
}

.docs-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--glass-border);
}

.docs-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 26px;
  font-weight: 700;
}

.docs-subtitle {
  margin: 8px 0 0;
  font-size: 13px;
  opacity: 0.7;
}

.docs-header-actions {
  display: flex;
  gap: 8px;
}

.docs-body {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 24px;
  margin-top: 22px;
  align-items: start;
}

.docs-toc {
  position: sticky;
  top: 20px;
  align-self: start;
  /* 章节较多时目录自身可滚动，但整体始终固定在左栏 */
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
}

.toc-title {
  font-size: 12px;
  font-weight: 700;
  opacity: 0.6;
  margin-bottom: 6px;
  letter-spacing: 0.5px;
}

.toc-item {
  font-size: 13px;
  color: inherit;
  text-decoration: none;
  padding: 5px 8px;
  border-radius: 8px;
  opacity: 0.85;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.toc-item:hover {
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  color: var(--primary-color-accent);
  opacity: 1;
}

/* 当前阅读到的章节高亮 */
.toc-item.is-active {
  background: color-mix(in srgb, var(--primary-color) 16%, transparent);
  color: var(--primary-color-accent);
  font-weight: 600;
  opacity: 1;
}

.docs-content {
  min-width: 0;
}

.doc-section {
  padding: 18px 20px;
  margin-bottom: 16px;
  border-radius: 16px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  scroll-margin-top: 20px;
}

.doc-section-title {
  margin: 0 0 10px;
  font-size: 17px;
  font-weight: 700;
}

.doc-section-intro {
  margin: 0 0 10px;
  font-size: 13px;
  opacity: 0.75;
  line-height: 1.7;
}

.doc-list {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.doc-list li {
  font-size: 13.5px;
  line-height: 1.75;
}

.doc-item-title {
  font-weight: 600;
}

.doc-item-desc {
  margin-left: 8px;
  opacity: 0.8;
}

.doc-sublist {
  margin: 6px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  opacity: 0.85;
}

.docs-footer {
  text-align: center;
  font-size: 12px;
  opacity: 0.55;
  padding: 10px 0 0;
}

@media (max-width: 900px) {
  .docs-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .docs-toc {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
  }

  .toc-title {
    width: 100%;
    margin-bottom: 0;
  }
}
</style>
