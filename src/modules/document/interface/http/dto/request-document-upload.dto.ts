import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsString, MaxLength, Min } from 'class-validator';

/**
 * Corps de `POST /v1/documents`. Le DTO valide la forme ; les règles métier
 * (titre normalisé, plafond de taille, attestation obligatoire) sont dans le
 * domaine et renvoient des 422 avec un `code` stable.
 */
export class RequestDocumentUploadDto {
  @ApiProperty({ example: 'Cours de droit constitutionnel — L1', maxLength: 200 })
  @IsString()
  // Borne de transport (le domaine applique la vraie limite de 200).
  @MaxLength(1000)
  title!: string;

  @ApiProperty({ description: 'Taille exacte du PDF en octets', example: 1_048_576, minimum: 1 })
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @ApiProperty({
    description:
      "L'utilisateur atteste disposer des droits d'usage sur ce document (RNF-24). Doit valoir true.",
    example: true,
  })
  @IsBoolean()
  rightsAttested!: boolean;
}
