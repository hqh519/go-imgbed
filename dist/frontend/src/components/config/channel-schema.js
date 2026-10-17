/**
 * 存储渠道 Schema —— 前端渠道配置的单一数据源。
 *
 * 字段 key 必须与后端适配器读取的 config 字段严格一致：
 *   S3 系（cos/minio/r2/s3）→ endpoint / region / accessKeyId|secretId / secretAccessKey|secretKey
 *                              / bucket / pathStyle / publicDomain / keyPrefix
 *   HTTP 系（easyimages/lsky/custom）→ apiUrl / fileField / tokenField / tokenHeader / tokenValue
 *                              / extraFields / responsePath / publicDomain / customDeleteUrl
 *   webdav → baseUri / username / password / publicDomain / directory
 *   immich → serverUrl / apiKey / albumId
 */

/**
 * 10 种渠道类型，顺序即界面展示顺序（上传设置 / 筛选下拉均按此排序）。
 *   dedicated = 走自有专属通道（后端有独立适配器实现）
 *   generic   = 与「自定义 Web 通道」共用同一套通用 HTTP 上传适配器
 */
export const CHANNEL_TYPES = [
    { value: 'easyimages', label: 'EasyImages 简单图床', dedicated: false, generic: true },
    { value: 'lsky', label: 'Lsky Pro 兰空图床', dedicated: false, generic: true },
    { value: 'cos', label: '腾讯云 COS', dedicated: true },
    { value: 'aliyun', label: '阿里云 OSS', dedicated: true },
    { value: 'immich', label: 'Immich 相册', dedicated: true },
    { value: 'minio', label: 'MinIO 对象存储', dedicated: true },
    { value: 'r2', label: 'Cloudflare R2', dedicated: true },
    { value: 's3', label: 'S3 兼容存储', dedicated: true },
    { value: 'webdav', label: 'WebDAV 协议存储', dedicated: true },
    { value: 'custom', label: '自定义 Web 通道', dedicated: false, generic: true }
];

/**
 * 渠道类型 → 后端 CHANNEL_LABEL（用于「渠道类型」筛选参数、卡片角标）。
 * 必须与 backend/src/common/file-view.ts 的 CHANNEL_LABEL 保持一致。
 */
export const CHANNEL_SHORT_LABEL = {
    cos: 'Tencent',
    minio: 'MinIO',
    r2: 'R2',
    s3: 'S3',
    aliyun: 'Aliyun',
    easyimages: 'Easy',
    lsky: 'Lsky',
    webdav: 'WebDAV',
    immich: 'Immich',
    custom: 'External'
};

/** 卡片上展示的摘要字段 */
export const SUMMARY_KEYS = {
    cos: [['bucket', 'Bucket'], ['region', '地域'], ['publicDomain', '外链域名']],
    minio: [['endpoint', 'Endpoint'], ['bucket', 'Bucket']],
    r2: [['endpoint', '账户ID/Endpoint'], ['bucket', 'Bucket'], ['publicDomain', '外链域名']],
    s3: [['endpoint', 'Endpoint'], ['bucket', 'Bucket']],
    aliyun: [['bucket', 'Bucket'], ['region', '地域'], ['publicDomain', '外链域名']],
    easyimages: [['apiUrl', '接口地址'], ['publicDomain', '外链域名']],
    lsky: [['apiUrl', '接口地址'], ['publicDomain', '外链域名']],
    webdav: [['baseUri', 'WebDAV 地址'], ['directory', '目录']],
    immich: [['serverUrl', '服务地址'], ['albumId', '相册 ID']],
    custom: [['apiUrl', '接口地址'], ['publicDomain', '外链域名']]
};

/** 各类型顶部提示 */
export const TYPE_TIPS = {
    cos: '腾讯云 COS 走专属通道：填写地域后可自动生成 Endpoint，也可手填 CDN 加速域名作为外链。',
    minio: 'MinIO 走专属通道：默认使用 Path-Style 寻址，桶需设置为「公开读」才能直接访问外链。若 MinIO 与图床同机 / 同 docker 网络，Endpoint 可直接填容器名（如 minio:9000）走内网通信。',
    r2: 'Cloudflare R2 走专属通道：Endpoint 可只填账户 ID（自动补全 r2.cloudflarestorage.com），外链需填写 r2.dev 子域或自定义域名。',
    s3: 'S3 兼容存储：通过标准 S3 协议接入（endpoint + 密钥 + 可选 Path-Style / 自定义 User-Agent），适用于 AWS S3 及各类 S3 协议对象存储（如阿里云 OSS、七牛、Backblaze B2、自建 MinIO 等）。自建服务可直接填内网 IP 或容器名。',
    aliyun: '阿里云 OSS 走专属通道：使用 OSS 官方接口与自有签名（不依赖 S3 兼容层），只需「Bucket + 地域 + AccessKey」即可；填了地域会自动推导 Endpoint（如 oss-cn-hangzhou.aliyuncs.com）。Bucket 需设置为「公共读」才能直接访问外链，或绑定自定义域名（CDN）后填在「自定义访问域名」。',
    easyimages: 'EasyImages 简单图床：填上传接口地址与 Token 即可，响应 URL 路径默认取 url。',
    lsky: 'Lsky Pro 兰空图床：v2 版接口为 /api/v1/upload，需带上 Authorization 头；v1 版响应路径为 data.url。',
    webdav: 'WebDAV 作为「存储渠道」：直接 PUT 文件到你的网盘，与「对外提供 WebDAV 服务」无关。地址同样支持内网 IP / 容器名（如 nas.local:5005/dav）。',
    immich: 'Immich 走专属通道：按「去重检查 → 上传 → 入相册 → 建分享链接」四步流程实现，外链为分享原图地址。服务地址支持填容器名（如 immich:2283）走内网。',
    custom: '自定义 Web 存储：只需「上传接口地址 + 文件字段名 + 响应 URL 路径」三件套即可接入任意 HTTP 图床；需要鉴权或附加参数时，用「自定义请求头 (JSON)」和「附加表单字段 (JSON)」。同时兼容主流通用 API：请求方法可选 POST/PUT/PATCH，请求体可选 multipart 或 JSON+Base64，响应 URL 路径支持多候选与自动探测，相对路径响应会自动补全域名。'
};

const f = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });

/**
 * 「服务地址 / Endpoint」统一提示 —— 支持内网 IP 与 Docker 容器名。
 *
 * 场景：go-imgbed 与 MinIO / Immich / 兰空 / WebDAV 等部署在同一台 NAS、
 * 同一个 docker compose 网络里时，用内网地址直连可以走内网链路（不经公网、
 * 不绕 CDN），上传明显更快。
 *
 * ⚠️ 关键点：渠道通信全部由「服务端」发起（后端去 PUT/POST 文件），
 * 浏览器只是把配置提交给后端 —— 所以图床自身对外是 https 也完全不影响
 * 用 http://minio:9000 这类内网地址通信，不存在混合内容拦截问题。
 */
const INTERNAL_ADDR_TIP =
    '支持内网直连：可直接填内网 IP 或 Docker 容器名（如 minio:9000、immich:2283、lsky:8080、192.168.1.10:9000、nas.local）。' +
    '与图床在同一网络时走内网通信、上传更快。不写协议时自动判断：内网 / 容器名按 http，公网域名按 https。' +
    '渠道通信由服务端发起，因此图床对外是 https 也不影响用内网地址连接。';

/** 外链域名（publicDomain）类字段的提示 —— 与上传通道区分开 */
const PUBLIC_DOMAIN_TIP =
    '这里是「外链域名」，用来替换外链的域名部分（外链 = 此域名 + 对象路径），与上面的上传通道相互独立：' +
    '上传可以走内网地址，外链域名另填。' +
    '取值取决于外链分发模式：' +
    '① 代理模式（默认，图片由本图床转发给访客）→ 取流由服务端发起，这里同样可以填内网地址（如 http://minio:9000/imgbed），' +
    '读写全走内网、速度最快，访客看到的仍是图床自己的域名；' +
    '② 302 重定向模式（访客浏览器直接打开该地址）→ 必须填公网可访问的地址，否则访客打不开图片。';


/** 各类型的业务字段 */
export const CHANNEL_FIELDS = {
    cos: () => [
        f('bucket', '存储桶名称 (Bucket)', { required: true, placeholder: 'mybucket（可只填前缀，由 AppID 自动补全）' }),
        f('appid', 'APPID', {
            placeholder: '125xxxxxxxxx',
            tip: '腾讯云账号 APPID。COS 的 Bucket 全名必须是 <bucket>-<APPID>；填了这里，上面只填桶名前缀也会自动补全。'
        }),
        f('cosVersion', 'COS 版本', {
            type: 'select',
            def: 'v5',
            options: [
                { value: 'v5', label: 'V5（签名算法 v5，默认，与 PHP 案例一致）' },
                { value: 'v4', label: 'V4（AWS 签名 v4 / S3 兼容）' }
            ],
            tip: '本系统通过 COS 官方 S3 兼容协议上传，两种签名均可正常工作，默认使用 V5。'
        }),
        f('region', '所属地域 (Region)', { required: true, placeholder: 'ap-guangzhou' }),
        f('endpoint', 'Endpoint', {
            placeholder: '留空将按地域自动生成',
            tip: '留空自动使用 https://cos.<region>.myqcloud.com；如使用私有或加速端点可在此覆盖。' + INTERNAL_ADDR_TIP
        }),
        f('publicDomain', '自定义访问域名', {
            placeholder: 'https://img.example.com',
            tip: '优先用于拼接外链（如 COS 的 CDN 加速域名）。留空则按 endpoint + bucket 自动拼接。' + PUBLIC_DOMAIN_TIP
        }),
        f('secretId', 'SecretId', { type: 'password', required: true, secret: true }),
        f('secretKey', 'SecretKey', { type: 'password', required: true, secret: true }),
        f('pathStyle', 'Path-Style 寻址', { type: 'switch', def: false }),
        f('keyPrefix', '指定存储路径（可选）', { placeholder: 'zblog/' }),
        f('suffix', '外链后缀（可选）', {
            placeholder: '?imageMogr2/thumbnail/800x',
            tip: '拼接在外链末尾的图片处理参数（对齐 PHP 案例的 tencent_suffix），如 COS 数据万象的 ?imageMogr2。'
        })
    ],
    minio: () => [
        f('endpoint', 'Endpoint', {
            required: true,
            placeholder: 'minio:9000 / 192.168.1.10:9000 / http://127.0.0.1:9000',
            tip: INTERNAL_ADDR_TIP
        }),
        f('bucket', '存储桶名称 (Bucket)', { required: true, placeholder: 'imgbed' }),
        f('region', 'Region', { placeholder: 'us-east-1', def: 'us-east-1' }),
        f('accessKeyId', 'AccessKey', { required: true, secret: true }),
        f('secretAccessKey', 'SecretKey', { type: 'password', required: true, secret: true }),
        f('publicDomain', '公开访问域名', {
            required: true,
            placeholder: 'http://minio:9000/imgbed 或 https://minio.example.com/imgbed',
            tip: 'MinIO 需将桶设为公开读；这里填写可直接访问的前缀地址（host 或 host/bucket）。' + PUBLIC_DOMAIN_TIP
        }),
        f('pathStyle', 'Path-Style 寻址', { type: 'switch', def: true, tip: 'MinIO 必须开启 Path-Style。' }),
        f('keyPrefix', '对象前缀（可选）', { placeholder: 'img/' })
    ],
    r2: () => [
        f('endpoint', '账户 ID 或 Endpoint', {
            required: true,
            placeholder: '1a2b3c4d... 或 https://xxx.r2.cloudflarestorage.com',
            tip: '只填账户 ID 会自动补全为 https://<账户ID>.r2.cloudflarestorage.com。' +
                'R2 是 Cloudflare 云服务、通常无需内网直连；若确实要指向自建 S3 网关，' +
                '请写完整协议（如 http://192.168.1.10:9000），否则会被当成账户 ID 处理。'
        }),
        f('bucket', '存储桶名称 (Bucket)', { required: true, placeholder: 'imgbed' }),
        f('accessKeyId', 'Access Key ID', { required: true, secret: true }),
        f('secretAccessKey', 'Secret Access Key', { type: 'password', required: true, secret: true }),
        f('publicDomain', '公开访问域名', {
            required: true,
            placeholder: 'https://pub-xxxx.r2.dev',
            tip: 'R2 直链需要开启公开访问（r2.dev 子域或绑定的自定义域名）。' + PUBLIC_DOMAIN_TIP
        }),
        f('keyPrefix', '对象前缀（可选）', { placeholder: 'img/' })
    ],
    s3: () => [
        f('endpoint', 'Endpoint', {
            required: true,
            placeholder: 'https://s3.us-east-1.amazonaws.com / minio:9000 / 192.168.1.10:9000',
            tip: INTERNAL_ADDR_TIP
        }),
        f('bucket', '存储桶名称 (Bucket)', { required: true, placeholder: 'imgbed' }),
        f('region', 'Region', { placeholder: 'us-east-1', def: 'us-east-1' }),
        f('accessKeyId', 'Access Key ID', { required: true, secret: true }),
        f('secretAccessKey', 'Secret Access Key', { type: 'password', required: true, secret: true }),
        f('pathStyle', 'Path-Style 寻址', { type: 'switch', def: false }),
        f('publicDomain', '自定义访问域名', {
            placeholder: 'https://cdn.example.com',
            tip: '留空则按 endpoint + bucket 自动拼接外链。' + PUBLIC_DOMAIN_TIP
        }),
        f('keyPrefix', '对象前缀（可选）', { placeholder: 'img/' }),
        f('userAgent', '自定义 User-Agent（可选）', {
            placeholder: 'CloudFlare-ImgBed',
            tip: '部分 S3 兼容服务商把访问密钥与特定 UA 绑定，配置后请求头将直接替换为该值（只能包含可打印 ASCII 字符）。'
        })
    ],
    aliyun: () => [
        f('bucket', '存储桶名称 (Bucket)', { required: true, placeholder: 'my-bucket（需为公共读，或绑定自定义域名）' }),
        f('region', '所属地域 (Region)', {
            required: true,
            placeholder: 'oss-cn-hangzhou',
            tip: '按控制台的地域填写（可省略前缀 oss-，如填 cn-hangzhou），系统自动推导 Endpoint 为 oss-<region>.aliyuncs.com。'
        }),
        f('endpoint', 'Endpoint（可选）', {
            placeholder: '留空将按地域自动生成',
            tip: '留空自动使用 https://oss-<region>.aliyuncs.com；如需走传输加速域名、内网端点或自建代理网关，在此覆盖。' + INTERNAL_ADDR_TIP
        }),
        f('accessKeyId', 'AccessKeyId', { required: true, secret: true }),
        f('accessKeySecret', 'AccessKeySecret', { type: 'password', required: true, secret: true }),
        f('publicDomain', '自定义访问域名', {
            placeholder: 'https://img.example.com',
            tip: '优先用于拼接外链（如 OSS 绑定的自定义域名 / CDN 加速域名）。留空则用 bucket.oss-<region>.aliyuncs.com（公共读才能直接访问）。' + PUBLIC_DOMAIN_TIP
        }),
        f('pathStyle', 'Path-Style 寻址', {
            type: 'switch',
            def: false,
            tip: '默认走 bucket.域名/key（虚拟主机风格）。若使用内网端点或代理网关不支持子域名，可开启后改用 域名/bucket/key。'
        }),
        f('keyPrefix', '指定存储路径（可选）', { placeholder: 'imgbed/' }),
        f('suffix', '外链后缀（可选）', {
            placeholder: '?x-oss-process=image/resize,w_800',
            tip: '拼接在外链末尾的图片处理参数（OSS 图片处理为 x-oss-process），如 ?x-oss-process=image/resize,w_800/quality,q_80。'
        })
    ],
    easyimages: () => [
        f('apiUrl', '上传接口地址', {
            required: true,
            placeholder: 'https://img.example.com/api/index.php 或 192.168.1.10/api/index.php',
            tip: INTERNAL_ADDR_TIP
        }),
        f('tokenValue', 'Token', {
            type: 'password',
            secret: true,
            tip: '对应 EasyImages 后台的 API Token。发送时作为表单字段 token 提交。'
        }),
        f('tokenField', 'Token 表单字段名', {
            placeholder: 'token',
            def: 'token',
            tip: 'Token 在 multipart 表单中的字段名。EasyImages 固定为 token —— 保留此字段是为了兼容其它同源图床（字段名不同时可直接改），不确定就保持默认。'
        }),
        f('fileField', '文件表单字段名', {
            placeholder: 'image',
            def: 'image',
            tip: '文件在 multipart 表单中的字段名。EasyImages 固定为 image（不是 file！填错就会报「没有选择上传的文件」）。同样可改以适配其它图床。'
        }),
        f('responsePath', '响应 URL 路径', { placeholder: 'url', def: 'url', tip: '响应 JSON 中外链所在路径，如 url、data.url、[0].src。' }),
        f('publicDomain', '域名重写（可选）', { placeholder: 'https://cdn.example.com', tip: PUBLIC_DOMAIN_TIP }),
        f('customDeleteUrl', '删除接口模板（可选）', { placeholder: 'https://img.example.com/app/del.php?hash=' })
    ],
    lsky: () => [
        f('apiUrl', '上传接口地址', {
            required: true,
            placeholder: 'https://img.example.com/api/v1/upload 或 lsky:8080/api/v1/upload',
            tip: INTERNAL_ADDR_TIP
        }),
        f('tokenValue', 'Authorization 请求头值', {
            type: 'password',
            required: true,
            secret: true,
            tip: '需带前缀，例如：Bearer 1|xxxxxxxx。'
        }),
        f('tokenHeader', '认证请求头名', { placeholder: 'Authorization', def: 'Authorization' }),
        f('fileField', '文件表单字段名', { placeholder: 'file', def: 'file' }),
        f('extraFields', '附加表单字段 (JSON)', {
            type: 'textarea',
            placeholder: '{"strategy_id":"1"}',
            tip: 'Lsky Pro v2 需要指定存储策略 ID 时填写。'
        }),
        f('responsePath', '响应 URL 路径', { placeholder: 'data.links.url', def: 'data.links.url', tip: 'Lsky v1 用 data.url，v2 用 data.links.url。' }),
        f('publicDomain', '域名重写（可选）', { placeholder: 'https://cdn.example.com', tip: PUBLIC_DOMAIN_TIP })
    ],
    webdav: () => [
        f('baseUri', 'WebDAV 地址', {
            required: true,
            placeholder: 'https://dav.example.com/remote.php/dav/files/user 或 nas.local:5005/dav',
            tip: INTERNAL_ADDR_TIP
        }),
        f('username', '用户名', { placeholder: 'user' }),
        f('password', '密码 / 应用密码', { type: 'password', secret: true }),
        f('directory', '存储目录（可选）', { placeholder: 'imgbed' }),
        f('publicDomain', '公开访问域名（可选）', {
            placeholder: 'https://img.example.com',
            tip: '若网盘提供公网直链域名可填写；留空则外链回落到 WebDAV 自身地址。' + PUBLIC_DOMAIN_TIP
        })
    ],
    immich: () => [
        f('serverUrl', 'Immich 服务地址', {
            required: true,
            placeholder: 'immich:2283 / 192.168.1.10:2283 / https://immich.example.com',
            tip: INTERNAL_ADDR_TIP
        }),
        f('apiKey', 'API Key', { type: 'password', required: true, secret: true }),
        f('albumId', '相册 ID（可选）', { placeholder: '上传后自动加入该相册' }),
        f('shareLinkId', '相册共享链接 ID / Key（可选）', {
            placeholder: '留空则每张图单独创建分享链接',
            tip: '可选项：填写后不再为每张图创建分享链接，直接复用该共享 Key 生成外链（适合已配置好相册共享链接的场景）。'
        }),
        f('domain', '自定义访问域名（可选）', {
            placeholder: 'https://img.example.com',
            tip: '外链使用的域名（对齐 PHP 案例的 immich_domain）；留空则用上面的服务地址。' + PUBLIC_DOMAIN_TIP
        })
    ],
    custom: () => [
        // ---- 与 PHP 联调案例一一对应的核心字段（apiUrl / fileField / responsePath / publicDomain / headers / body），
        //      httpMethod 与 requestFormat 为「兼容主流通用 API」新增的可选项 ----
        f('apiUrl', '上传接口地址', {
            required: true,
            placeholder: 'https://your-imgbed.com/api/upload 或 192.168.1.10/api/upload',
            tip: '对齐 PHP 案例的 custom_api：文件将以 multipart/form-data POST 到这里。支持 {filename} {name} {ext} {mime} {size} {timestamp} {random} 占位符。' + INTERNAL_ADDR_TIP
        }),
        f('httpMethod', '请求方法', {
            type: 'select',
            def: 'POST',
            options: [
                { value: 'POST', label: 'POST（默认，绝大多数图床）' },
                { value: 'PUT', label: 'PUT' },
                { value: 'PATCH', label: 'PATCH' }
            ],
            tip: '对齐 PHP 案例的 POST 请求；少数自建接口要求 PUT / PATCH 时在这里切换。'
        }),
        f('requestFormat', '请求体格式', {
            type: 'select',
            def: 'multipart',
            options: [
                { value: 'multipart', label: 'multipart/form-data（默认，与 PHP 案例一致）' },
                { value: 'json', label: 'JSON + Base64（兼容只收 base64 的接口）' }
            ],
            tip: '选 JSON 时文件会转成 data:<mime>;base64,xxx 放进「文件表单字段名」指定的键，用于只接受 base64 的接口（如 SM.MS、ImgBB、聚合图床等）。'
        }),
        f('fileField', '文件表单字段名', {
            placeholder: 'image',
            def: 'image',
            tip: '对齐 PHP 案例的 custom_post_param，默认 image；若对方接口用 file 请改成 file。'
        }),
        f('responsePath', '响应 URL 路径', {
            placeholder: 'url',
            def: 'url',
            tip: '对齐 PHP 案例的 custom_json_path，默认 url；支持 a.b.c、[0].src、data.list.0.url 等路径，也可用「|」写多候选（如 data.url|url|data.links.url），填 auto 或留空则自动探测主流图床的常见位置。'
        }),
        f('publicDomain', '访问域名（可选）', {
            placeholder: 'https://cdn.example.com',
            tip: '对齐 PHP 案例的 custom_domain：把响应 URL 的域名替换为此值，用于加 CDN 或修正内网地址。' + PUBLIC_DOMAIN_TIP
        }),
        f('headers', '自定义请求头 (JSON)', {
            type: 'textarea',
            placeholder: '{"Authorization":"Bearer xxx","X-Custom":"1"}',
            tip: '对齐 PHP 案例的 custom_headers：任意请求头 JSON 对象（键与值都用双引号）。需要鉴权就写在这里。'
        }),
        f('body', '附加表单字段 (JSON)', {
            type: 'textarea',
            placeholder: '{"album":"default","strategy_id":"1"}',
            tip: '对齐 PHP 案例的 custom_body：随文件一起 POST 的额外表单字段，JSON 对象。'
        }),
        f('customDeleteUrl', '删除接口模板（可选）', {
            placeholder: 'https://your-imgbed.com/api/delete?url={url}',
            tip: '含 {url} 占位符，删除时会替换为文件的完整外链地址。'
        }),
        f('customDeleteMethod', '删除请求方法', { placeholder: 'GET', def: 'GET' }),
        // ---- 以下为兼容早期版本的字段，新配置建议直接用上面的 headers / body ----
        f('tokenHeader', '【兼容】认证请求头名', { placeholder: 'Authorization' }),
        f('tokenValue', '【兼容】认证请求头值', { type: 'password', secret: true, tip: '可填写完整值，如 Bearer xxxx；缺 scheme 时自动补 Bearer。' }),
        f('tokenField', '【兼容】表单字段认证名', { placeholder: 'token' }),
        f('extraFields', '【兼容】附加表单字段 (JSON)', { type: 'textarea', placeholder: '{"album":"default"}' })
    ]
};

/**
 * 容量限制（所有类型通用，追加在业务字段之后）。
 * 后两项依赖「启用容量限制」，未开启时隐藏（showWhen 由 visibleFields 处理）。
 */
const QUOTA_FIELDS = () => [
    { key: 'quotaEnabled', label: '启用容量限制', type: 'switch', def: false },
    {
        key: 'quotaLimitGB',
        label: '容量上限 (GB)',
        type: 'number',
        def: 10,
        min: 0.1,
        step: 1,
        precision: 1,
        showWhen: { key: 'quotaEnabled', value: true }
    },
    {
        key: 'quotaThreshold',
        label: '告警阈值 (%)',
        type: 'number',
        def: 95,
        min: 50,
        max: 100,
        step: 5,
        showWhen: { key: 'quotaEnabled', value: true }
    }
];

/**
 * 按 showWhen 条件过滤字段。
 * showWhen: { key, value } —— 仅当 model[key] === value 时才渲染该字段。
 * @param {Array} fields
 * @param {object} model 当前渠道 config
 */
export function visibleFields(fields, model) {
    return (fields || []).filter((field) => {
        const cond = field.showWhen;
        if (!cond) return true;
        const actual = model ? model[cond.key] : undefined;
        return Array.isArray(cond.value) ? cond.value.includes(actual) : actual === cond.value;
    });
}

/** 生成某类型的完整字段列表（业务字段 + 容量字段） */
export function fieldsOf(type) {
    const base = CHANNEL_FIELDS[type] ? CHANNEL_FIELDS[type]() : [];
    return [...base, ...QUOTA_FIELDS()];
}

/** 生成某类型的默认 config 对象（用于新增渠道时预填） */
export function buildDefaults(type) {
    const out = {};
    for (const field of fieldsOf(type)) {
        if (field.def !== undefined) out[field.key] = field.def;
        else if (field.type === 'switch') out[field.key] = false;
        else out[field.key] = '';
    }
    return out;
}
