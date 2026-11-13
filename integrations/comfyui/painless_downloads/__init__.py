"""Explicit, local model downloads for pain(less)'s pinned ComfyUI frontend."""
import asyncio
import hashlib
from contextlib import suppress
import os
from pathlib import Path
from urllib.parse import urlsplit

import aiohttp
from aiohttp import web
import folder_paths
from server import PromptServer

NODE_CLASS_MAPPINGS = {}
WEB_DIRECTORY = './web'
CATEGORIES = {'checkpoints', 'text_encoders', 'clip', 'clip_vision', 'diffusion_models',
              'unet', 'vae', 'loras', 'controlnet', 'embeddings', 'upscale_models',
              'vae_approx', 'hypernetworks', 'gligen', 'style_models'}
SUFFIXES = {'.safetensors', '.sft', '.ckpt', '.pt', '.pth', '.gguf'}
JOBS = {}
TASKS = {}
ACTIVE = ('queued', 'downloading', 'cancelling')
LOCK = asyncio.Semaphore(1)


def validate_url(url, redirect=False):
    parsed = urlsplit(url)
    host = (parsed.hostname or '').lower()
    trusted = host in {'huggingface.co', 'civitai.com', 'civitai.red'}
    if redirect:
        trusted |= any(host.endswith('.' + domain) for domain in
                       ('hf.co', 'huggingface.co', 'civitai.com', 'civitai.red', 'cloudflarestorage.com'))
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443) or not trusted:
        raise ValueError('Use an HTTPS model download link from Hugging Face or Civitai.')
    return url


def destination(name, category):
    if not isinstance(name, str) or not name or name != Path(name).name or '\\' in name or len(name) > 240:
        raise ValueError('The model filename must not contain a path.')
    if Path(name).suffix.lower() not in SUFFIXES or category not in CATEGORIES:
        raise ValueError('Unsupported model file or category.')
    category = {'clip': 'text_encoders', 'unet': 'diffusion_models'}.get(category, category)
    root = Path(folder_paths.models_dir).resolve()
    target = root / category / name
    if not target.resolve().is_relative_to(root) or target.is_symlink():
        raise ValueError('The model path must stay inside the models folder.')
    return target


async def transfer(job, target):
    part = target.with_name(target.name + '.part')
    marker = target.with_name(target.name + '.part.url')
    # Never follow existing links or replace a completed model.
    for path in (part, marker):
        if path.is_symlink():
            raise ValueError('Download staging files must not be symbolic links.')
    if target.exists():
        if not target.is_file() or target.stat().st_size == 0:
            raise ValueError('An invalid file already exists at the model destination.')
        job.update(status='complete', received=target.stat().st_size, total=target.stat().st_size)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    same_source = marker.exists() and marker.read_text() == job['url']
    offset = part.stat().st_size if part.exists() and same_source else 0
    marker.write_text(job['url'])
    headers = {'Range': f'bytes={offset}-'} if offset else {}
    timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=120)
    async with aiohttp.ClientSession(timeout=timeout, auto_decompress=False) as session:
        url = job['url']
        for attempt in range(10):
            response = await session.get(url, headers=headers, allow_redirects=False)
            if response.status not in (301, 302, 303, 307, 308):
                break
            from urllib.parse import urljoin
            url = validate_url(urljoin(url, response.headers.get('Location', '')), redirect=True)
            response.release()
        else:
            raise ValueError('Too many download redirects.')
        async with response:
            if response.status not in (200, 206):
                raise ValueError(f'Download returned HTTP {response.status}. Gated models need access from their provider.')
            if response.status == 206:
                if not offset or not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-'):
                    raise ValueError('The server returned an unexpected resume range.')
            else:
                offset = 0
            if 'text/html' in response.headers.get('Content-Type', ''):
                raise ValueError('The link returned a web page instead of a model.')
            length = int(response.headers.get('Content-Length', '0'))
            job.update(status='downloading', received=offset, total=offset + length if length else 0)
            with part.open('ab' if offset else 'wb') as output:
                async for chunk in response.content.iter_chunked(1024 * 1024):
                    output.write(chunk)
                    job['received'] += len(chunk)
                output.flush()
                os.fsync(output.fileno())
            if not job['received'] or (job['total'] and job['received'] != job['total']):
                raise ValueError('The download ended before the complete model arrived.')
    # Hard-link publication is atomic and refuses to overwrite a model that appeared during the download.
    os.link(part, target)
    part.unlink()
    marker.unlink(missing_ok=True)
    job['status'] = 'complete'


async def run(job, target):
    try:
        async with LOCK:
            await transfer(job, target)
    except asyncio.CancelledError:
        job.update(status='paused', error='')
        raise
    except Exception as exc:
        job.update(status='error', error=str(exc))


def local_request(request):
    origin = request.headers.get('Origin')
    if origin and urlsplit(origin).netloc != request.host:
        raise web.HTTPForbidden(text='Cross-origin download requests are not accepted.')


@PromptServer.instance.routes.post('/painless/downloads')
async def start(request):
    local_request(request)
    try:
        body = await request.json()
        url = validate_url(body['url'])
        target = destination(body['name'], body['directory'])
    except (ValueError, TypeError, KeyError) as exc:
        raise web.HTTPBadRequest(text=str(exc)) from exc
    key = hashlib.sha256(str(target).encode()).hexdigest()[:24]
    existing = JOBS.get(key)
    if existing and existing['status'] in ACTIVE:
        return web.json_response(existing)
    if sum(job['status'] in ACTIVE for job in JOBS.values()) >= 32:
        raise web.HTTPTooManyRequests(text='The download queue is full.')
    job = dict(id=key, name=body['name'], directory=body['directory'], url=url,
               status='queued', received=0, total=0, error='')
    JOBS[key] = job
    task = asyncio.create_task(run(job, target))
    TASKS[key] = task
    def finished(done):
        if TASKS.get(key) is done:
            TASKS.pop(key, None)
    task.add_done_callback(finished)
    return web.json_response(job)


@PromptServer.instance.routes.get('/painless/downloads/{key}')
async def status(request):
    job = JOBS.get(request.match_info['key'])
    if job is None:
        raise web.HTTPNotFound(text='Download not found. Click Download to resume it.')
    return web.json_response(job)


def recover_partials():
    """Recover resumable transfers after a server restart without starting them."""
    root = Path(folder_paths.models_dir)
    for marker in root.glob('*/*.part.url'):
        try:
            name = marker.name.removesuffix('.part.url')
            target = destination(name, marker.parent.name)
            part = target.with_name(target.name + '.part')
            if marker.is_symlink() or part.is_symlink() or not part.is_file() or target.exists():
                continue
            key = hashlib.sha256(str(target).encode()).hexdigest()[:24]
            if key not in JOBS:
                JOBS[key] = dict(id=key, name=name, directory=marker.parent.name,
                                 url=validate_url(marker.read_text()), status='paused',
                                 received=part.stat().st_size, total=0, error='')
        except (OSError, ValueError):
            continue


@PromptServer.instance.routes.get('/painless/downloads')
async def listing(request):
    recover_partials()
    return web.json_response(list(JOBS.values()))


async def pause_job(key):
    job = JOBS.get(key)
    if job is None:
        raise web.HTTPNotFound(text='Download not found.')
    task = TASKS.get(key)
    if task and not task.done():
        job['status'] = 'cancelling'
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        job.update(status='paused', error='')
    return job


@PromptServer.instance.routes.post('/painless/downloads/{key}/cancel')
async def cancel(request):
    local_request(request)
    return web.json_response(await pause_job(request.match_info['key']))


@PromptServer.instance.routes.delete('/painless/downloads/{key}')
async def remove_partial(request):
    local_request(request)
    job = await pause_job(request.match_info['key'])
    target = destination(job['name'], job['directory'])
    for suffix in ('.part', '.part.url'):
        path = target.with_name(target.name + suffix)
        if path.is_symlink():
            raise web.HTTPBadRequest(text='Refusing to remove a linked staging file.')
        path.unlink(missing_ok=True)
    JOBS.pop(job['id'], None)
    return web.json_response({'removed': True})
