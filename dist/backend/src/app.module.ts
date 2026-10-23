import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { OptionalAuthGuard } from './auth/auth.guard';
import { ChannelsController, ChannelManageController, ChannelAllowedController, StorageSettingsController, ChannelsService } from './channels/channels.controller';
import { UploadController } from './upload/upload.controller';
import { UploadService } from './upload/upload.service';
import { LinkController, ManageController, UserConfigController } from './files/files.controller';
import { AvatarController, UsersController } from './users/users.controller';
import { TokenApiController } from './tokens/token-api.controller';
import { WebDavController } from './webdav/webdav.controller';
import { SettingsService } from './settings/settings.service';
import { SysConfigService } from './settings/sysconfig.service';
import { StorageChannelService } from './storage/storage-channel.service';
import { PublicCompatController, ManageCompatController } from './compat/compat.controller';
// v2.3.0 新增：访问记录 + 发信邮箱
import { AccessController, AccessAdminController } from './access/access.controller';
import { AccessService } from './access/access.service';
import { MailController } from './mail/mail.controller';
import { MailService } from './mail/mail.service';

@Module({
  controllers: [
    AuthController,
    ChannelsController,
    ChannelAllowedController,
    ChannelManageController,
    StorageSettingsController,
    UploadController,
    LinkController,
    ManageController,
    UserConfigController,
    UsersController,
    AvatarController,
    TokenApiController,
    WebDavController,
    PublicCompatController,
    ManageCompatController,
    AccessController,
    AccessAdminController,
    MailController,
  ],
  providers: [
    SettingsService,
    SysConfigService,
    ChannelsService,
    StorageChannelService,
    UploadService,
    OptionalAuthGuard,
    AccessService,
    MailService,
  ],
})
export class AppModule {}
