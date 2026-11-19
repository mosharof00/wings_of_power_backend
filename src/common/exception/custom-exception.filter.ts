import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';

function messageFromResponse(response: string | object): string {
  if (typeof response === 'string') {
    return response;
  }
  if (response && typeof response === 'object') {
    const body = response as {
      message?: string | string[] | Record<string, unknown>;
      error?: string;
    };
    const raw = body.message;
    if (typeof raw === 'string' && raw.trim()) {
      return raw;
    }
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map(String).join('; ');
    }
    if (raw && typeof raw === 'object') {
      const nested = (raw as { message?: unknown }).message;
      if (typeof nested === 'string' && nested.trim()) {
        return nested;
      }
    }
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error;
    }
  }
  return 'An error occurred';
}

@Catch(HttpException)
export class CustomExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const status = exception.getStatus();

    response.status(status).json({
      success: false,
      message: messageFromResponse(exception.getResponse()),
    });
  }
}
