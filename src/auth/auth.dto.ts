import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @MaxLength(20)
  phone!: string;
}

export class VerifyOtpDto {
  @IsString()
  @MaxLength(20)
  phone!: string;

  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;
}

export class TelebirrLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  authToken!: string;
}

export class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}
