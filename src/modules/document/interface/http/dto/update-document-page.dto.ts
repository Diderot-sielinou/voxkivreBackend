import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateDocumentPageDto {
  @ApiProperty({ description: 'Texte corrigé de la page (peut être vide)', maxLength: 20_000 })
  @IsString()
  // Borne de transport (le domaine applique la vraie limite et les caractères interdits).
  @MaxLength(25_000)
  text!: string;
}
