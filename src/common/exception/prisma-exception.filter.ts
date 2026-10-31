import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from 'prisma/generated';

const {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientValidationError,
  PrismaClientInitializationError,
  PrismaClientRustPanicError,
} = Prisma;

import { Response } from 'express';

@Catch(
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientValidationError,
  PrismaClientInitializationError,
  PrismaClientRustPanicError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const isDev = process.env.NODE_ENV === 'development';
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred while accessing the database.';

    if (exception instanceof PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2000':
          status = HttpStatus.BAD_REQUEST;
          message = 'The provided value for a field is too long.';
          break;
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = 'Unique constraint failed on one or more fields.';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          message = 'Foreign key constraint failed.';
          break;
        case 'P2004':
          status = HttpStatus.BAD_REQUEST;
          message = 'A constraint failed on the database.';
          break;
        case 'P2005':
          status = HttpStatus.BAD_REQUEST;
          message = 'Invalid value stored in the database.';
          break;
        case 'P2006':
          status = HttpStatus.BAD_REQUEST;
          message = 'The provided value is invalid for the field.';
          break;
        case 'P2007':
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          message = 'Data validation error.';
          break;
        case 'P2010':
          status = HttpStatus.BAD_REQUEST;
          message = 'Raw query failed. Check the query syntax.';
          break;
        case 'P2011':
          status = HttpStatus.BAD_REQUEST;
          message = 'Null constraint violation.';
          break;
        case 'P2014':
          status = HttpStatus.BAD_REQUEST;
          message = 'Invalid relation detected in database.';
          break;
        case 'P2016':
          status = HttpStatus.BAD_REQUEST;
          message = 'Query interpretation error.';
          break;
        case 'P2017':
          status = HttpStatus.BAD_REQUEST;
          message = 'Relation records not found.';
          break;
        case 'P2021':
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          message = 'Table not found in the database.';
          break;
        case 'P2022':
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          message = 'Column not found in the database.';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found.';
          break;
        case 'P2033':
          status = HttpStatus.BAD_REQUEST;
          message = 'Inconsistent column data type.';
          break;
        default:
          message = 'A database error occurred.';
      }
    } else if (exception instanceof PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided for a Prisma operation.';
    } else if (exception instanceof PrismaClientUnknownRequestError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unknown database error occurred.';
    } else if (exception instanceof PrismaClientInitializationError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message =
        'Failed to initialize Prisma Client. Check database connection settings.';
    } else if (exception instanceof PrismaClientRustPanicError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message =
        'Prisma engine panicked. Try restarting the server or check Prisma setup.';
    }

    const errorResponse: any = {
      success: false,
      statusCode: status,
      message,
    };

    if (isDev) {
      errorResponse.dev = {
        name: exception.name,
        code: exception.code,
        meta: exception.meta,
        cause: exception.cause,
        message: exception.message,
        stack: exception.stack,
      };
    }

    response.status(status).json(errorResponse);
  }
}
