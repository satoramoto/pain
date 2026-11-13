"""The downloader's file contract, exercised with a local HTTP response fixture."""
import asyncio
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

# ComfyUI owns the route registry; the tests only exercise our adapter.
sys.modules['folder_paths']=types.SimpleNamespace(models_dir='/unused')
class Routes:
    def post(self,*args): return lambda fn:fn
    def get(self,*args): return lambda fn:fn
    def delete(self,*args): return lambda fn:fn
sys.modules['server']=types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=Routes())))
spec=importlib.util.spec_from_file_location('painless_downloads',Path(__file__).resolve().parents[1]/'integrations/comfyui/painless_downloads/__init__.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class DownloadTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        module.JOBS.clear();module.TASKS.clear()
        self.root=Path(self.tmp.name)
        self.patch=patch.object(module.folder_paths,'models_dir',str(self.root));self.patch.start();self.addCleanup(self.patch.stop)

    def test_paths_and_sources_are_bounded(self):
        self.assertEqual(module.destination('test.safetensors','vae'),self.root/'vae/test.safetensors')
        self.assertEqual(module.destination('test.safetensors','clip'),self.root/'text_encoders/test.safetensors')
        for name,category in [('../escape.safetensors','vae'),('/tmp/a.safetensors','vae'),('a.py','vae'),('a.safetensors','../outside')]:
            with self.assertRaises(ValueError):module.destination(name,category)
        for url in ['http://huggingface.co/a','https://huggingface.co.evil.test/a','https://127.0.0.1/a','https://user@huggingface.co/a']:
            with self.assertRaises(ValueError):module.validate_url(url)
        outside=self.root/'outside';outside.mkdir();(self.root/'vae').symlink_to('/tmp')
        with self.assertRaises(ValueError):module.destination('a.safetensors','vae')

    async def test_stream_resume_and_no_overwrite(self):
        from aiohttp import web
        data=b'0123456789'*100
        ranges=[]
        async def handler(request):
            offset=int(request.headers.get('Range','bytes=0-').split('=')[1].split('-')[0]);ranges.append(offset)
            return web.Response(body=data[offset:],status=206 if offset else 200,headers={'Content-Range':f'bytes {offset}-{len(data)-1}/{len(data)}'} if offset else {})
        app=web.Application();app.router.add_get('/model',handler)
        runner=web.AppRunner(app);await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start()
        port=site._server.sockets[0].getsockname()[1]
        try:
            target=module.destination('model.safetensors','vae');target.parent.mkdir()
            url=f'http://127.0.0.1:{port}/model'
            target.with_name(target.name+'.part').write_bytes(data[:100])
            target.with_name(target.name+'.part.url').write_text(url)
            job=dict(url=url,status='queued',received=0,total=0)
            await module.transfer(job,target)
            self.assertEqual(target.read_bytes(),data);self.assertEqual(ranges,[100]);self.assertEqual(job['status'],'complete')
            self.assertFalse(target.with_name(target.name+'.part').exists())
            target.write_bytes(b'existing')
            await module.transfer(job,target)
            self.assertEqual(target.read_bytes(),b'existing');self.assertEqual(ranges,[100])
        finally:await runner.cleanup()

    async def test_cancel_closes_transfer_keeps_partial_and_recovers_after_restart(self):
        from aiohttp import web
        sent=asyncio.Event()
        release=asyncio.Event()
        async def handler(request):
            response=web.StreamResponse();await response.prepare(request)
            await response.write(b'partial');sent.set()
            await release.wait()
            return response
        app=web.Application();app.router.add_get('/model',handler)
        runner=web.AppRunner(app);await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start()
        target=module.destination('cancel.safetensors','vae')
        url=f'http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}/model'
        job=dict(id='cancel',name=target.name,directory='vae',url=url,status='queued',received=0,total=0)
        module.JOBS['cancel']=job
        task=asyncio.create_task(module.run(job,target));module.TASKS['cancel']=task
        try:
            await asyncio.wait_for(sent.wait(),2)
            for _ in range(100):
                if job['received']:break
                await asyncio.sleep(.01)
            await module.pause_job('cancel')
            self.assertTrue(task.cancelled());self.assertEqual(job['status'],'paused')
            self.assertFalse(target.exists())
            self.assertEqual(target.with_name(target.name+'.part').read_bytes(),b'partial')
            target.with_name(target.name+'.part.url').write_text('https://huggingface.co/example/model/resolve/main/cancel.safetensors')
            module.JOBS.clear();module.recover_partials()
            recovered=next(iter(module.JOBS.values()))
            self.assertEqual(recovered['status'],'paused');self.assertEqual(recovered['received'],7)
        finally:
            release.set();await runner.cleanup()

    async def test_cancel_queued_job_and_remove_only_partial_files(self):
        job=dict(id='queued',name='queued.safetensors',directory='vae',url='https://huggingface.co/a',status='queued',received=0,total=0)
        module.JOBS['queued']=job
        task=asyncio.create_task(asyncio.sleep(100));module.TASKS['queued']=task
        await module.pause_job('queued')
        self.assertTrue(task.cancelled());self.assertEqual(job['status'],'paused')
        target=module.destination(job['name'],job['directory']);target.parent.mkdir()
        target.write_bytes(b'completed-model')
        target.with_name(target.name+'.part').write_bytes(b'partial')
        target.with_name(target.name+'.part.url').write_text(job['url'])
        request=types.SimpleNamespace(headers={},host='localhost',match_info={'key':'queued'})
        await module.remove_partial(request)
        self.assertEqual(target.read_bytes(),b'completed-model')
        self.assertFalse(target.with_name(target.name+'.part').exists())
        self.assertNotIn('queued',module.JOBS)

    async def test_failure_keeps_final_path_absent(self):
        target=module.destination('missing.safetensors','vae')
        job=dict(url='http://127.0.0.1:1/missing',status='queued',received=0,total=0)
        await module.run(job,target)
        self.assertEqual(job['status'],'error');self.assertFalse(target.exists())

if __name__=='__main__':unittest.main()
