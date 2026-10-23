import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { OptionalAuthGuard } from './auth/auth.guard';
import { ChannelsController, ChannelManageController, StorageSettingsController, ChannelsService } from './channels/channels.controller';
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

@Module({
  controllers: [
    AuthController,
    ChannelsController,
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
  ],
  providers: [SettingsService, SysConfigService, ChannelsService, StorageChannelService, UploadService, OptionalAuthGuard],
})
export class AppModule {}
