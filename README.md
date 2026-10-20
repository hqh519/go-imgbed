基于 MarSeventh 大佬开发的 ![CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 基础上改造的 Docker 版在线图床
---
因个人需求原因，移除了 CloudFlare-ImgBed 原有的存储渠道，改成了一些常用存储渠道，有EasyImages、LskyPro、immich、MinIO、Cloudflare R2、S3、腾讯云、阿里云、WebDAV、Web自定义接口

然后增加了一个备份渠道，即上传的图片可以同时备份到多一个渠道存储，可以在后台切换渠道源。

需要继续用 CloudFlare-ImgBed 的TG图床的话，又想使用国内渠道的话，可以使用 go-imgbed，把默认存储渠道配置为常用渠道，然后把备份渠道配置到 CloudFlare-ImgBed，再从 CloudFlare-ImgBed 配置到TG也是一样的效果。

---

【版本说明】

**v2.0以下的版本使用的是 SQLite，v2.0.0及以上版本改为了 PostgreSQL**
