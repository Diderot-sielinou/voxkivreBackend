import { ApiProperty } from '@nestjs/swagger';

import { DocumentResponseDto } from './document-response.dto';

export class DocumentListResponseDto {
  @ApiProperty({ type: [DocumentResponseDto] })
  items!: DocumentResponseDto[];

  @ApiProperty({ type: String, nullable: true, description: '`null` en fin de liste' })
  nextCursor!: string | null;
}
