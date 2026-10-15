import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Corps de `PATCH /v1/documents/:id`. Le DTO valide la forme ; la règle
 * métier du titre (1..200 caractères normalisés) est dans le domaine (422
 * `INVALID_DOCUMENT_TITLE`).
 */
export class RenameDocumentDto {
  @ApiProperty({ example: 'Droit des obligations — L2', maxLength: 200 })
  @IsString()
  // Borne de transport (le domaine applique la vraie limite de 200).
  @MaxLength(1000)
  title!: string;
}
