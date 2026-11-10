import { Controller, Get, Post, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ExtensionsService } from './extensions.service';
import { Public } from '../auth/auth.guards';
import { ExtensionItem } from './extension.types';

@ApiTags('extensions')
@Controller('extensions')
export class ExtensionsController {
  constructor(private readonly extensionsService: ExtensionsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách tiện ích và plugin trên chợ mở rộng' })
  @ApiQuery({ name: 'category', required: false, enum: ['all', 'plugin', 'theme', 'template'] })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Danh sách các extension trên marketplace' })
  findAll(
    @Query('category') category?: string,
    @Query('search') search?: string,
  ): ExtensionItem[] {
    return this.extensionsService.findAll({ category, search });
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Lấy thông tin chi tiết một tiện ích' })
  @ApiResponse({ status: 200, description: 'Chi tiết tiện ích' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy tiện ích' })
  findOne(@Param('id') id: string): ExtensionItem {
    return this.extensionsService.findOne(id);
  }

  @Public()
  @Post(':id/install')
  @ApiOperation({ summary: 'Cài đặt một tiện ích hoặc tải gói template' })
  @ApiResponse({ status: 201, description: 'Cài đặt tiện ích thành công' })
  @ApiResponse({ status: 400, description: 'Tiện ích chưa sẵn sàng để cài đặt' })
  install(@Param('id') id: string) {
    return this.extensionsService.install(id);
  }

  @Public()
  @Post(':id/uninstall')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gỡ cài đặt một tiện ích' })
  @ApiResponse({ status: 200, description: 'Gỡ tiện ích thành công' })
  uninstall(@Param('id') id: string) {
    return this.extensionsService.uninstall(id);
  }
}
