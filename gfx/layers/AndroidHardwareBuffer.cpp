/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "AndroidHardwareBuffer.h"

#include "mozilla/gfx/2D.h"
#include "mozilla/gfx/gfxVars.h"
#include "mozilla/layers/ImageBridgeChild.h"
#include "mozilla/layers/TextureClientSharedSurface.h"
#include "mozilla/TimeStamp.h"
#include "mozilla/UniquePtrExtensions.h"

namespace mozilla {
namespace layers {

static uint32_t ToAHardwareBuffer_Format(gfx::SurfaceFormat aFormat) {
  switch (aFormat) {
    case gfx::SurfaceFormat::R8G8B8A8:
    case gfx::SurfaceFormat::B8G8R8A8:
      return AHARDWAREBUFFER_FORMAT_R8G8B8A8_UNORM;

    case gfx::SurfaceFormat::R8G8B8X8:
    case gfx::SurfaceFormat::B8G8R8X8:
      return AHARDWAREBUFFER_FORMAT_R8G8B8X8_UNORM;

    case gfx::SurfaceFormat::R5G6B5_UINT16:
      return AHARDWAREBUFFER_FORMAT_R5G6B5_UNORM;

    default:
      MOZ_ASSERT_UNREACHABLE("Unsupported SurfaceFormat");
      return AHARDWAREBUFFER_FORMAT_R8G8B8A8_UNORM;
  }
}

StaticAutoPtr<AndroidHardwareBufferApi> AndroidHardwareBufferApi::sInstance;

/* static */
void AndroidHardwareBufferApi::Init() {
  MOZ_ASSERT(XRE_IsGPUProcess());

  sInstance = new AndroidHardwareBufferApi();
  if (!sInstance->Load()) {
    sInstance = nullptr;
  }
}

/* static */
void AndroidHardwareBufferApi::Shutdown() { sInstance = nullptr; }

AndroidHardwareBufferApi::AndroidHardwareBufferApi() {}

bool AndroidHardwareBufferApi::Load() {
  if (__builtin_available(android 26, *)) {
    mAHardwareBuffer_allocate = AHardwareBuffer_allocate;  // API 26
    mAHardwareBuffer_acquire = AHardwareBuffer_acquire;    // API 26
    mAHardwareBuffer_release = AHardwareBuffer_release;    // API 26
    mAHardwareBuffer_describe = AHardwareBuffer_describe;  // API 26
    mAHardwareBuffer_lock = AHardwareBuffer_lock;          // API 26
    mAHardwareBuffer_unlock = AHardwareBuffer_unlock;      // API 26
    mAHardwareBuffer_sendHandleToUnixSocket =
        AHardwareBuffer_sendHandleToUnixSocket;  // API 26
    mAHardwareBuffer_recvHandleFromUnixSocket =
        AHardwareBuffer_recvHandleFromUnixSocket;  // API 26
    return true;
  } else {
    gfxCriticalNote << "Failed to load AHardwareBuffer";
    return false;
  }
}

void AndroidHardwareBufferApi::Allocate(const AHardwareBuffer_Desc* aDesc,
                                        AHardwareBuffer** aOutBuffer) {
  mAHardwareBuffer_allocate(aDesc, aOutBuffer);
}

void AndroidHardwareBufferApi::Acquire(AHardwareBuffer* aBuffer) {
  mAHardwareBuffer_acquire(aBuffer);
}

void AndroidHardwareBufferApi::Release(AHardwareBuffer* aBuffer) {
  mAHardwareBuffer_release(aBuffer);
}

void AndroidHardwareBufferApi::Describe(const AHardwareBuffer* aBuffer,
                                        AHardwareBuffer_Desc* aOutDesc) {
  mAHardwareBuffer_describe(aBuffer, aOutDesc);
}

int AndroidHardwareBufferApi::Lock(AHardwareBuffer* aBuffer, uint64_t aUsage,
                                   int32_t aFence, const ARect* aRect,
                                   void** aOutVirtualAddress) {
  return mAHardwareBuffer_lock(aBuffer, aUsage, aFence, aRect,
                               aOutVirtualAddress);
}

int AndroidHardwareBufferApi::Unlock(AHardwareBuffer* aBuffer,
                                     int32_t* aFence) {
  return mAHardwareBuffer_unlock(aBuffer, aFence);
}

int AndroidHardwareBufferApi::SendHandleToUnixSocket(
    const AHardwareBuffer* aBuffer, int aSocketFd) {
  return mAHardwareBuffer_sendHandleToUnixSocket(aBuffer, aSocketFd);
}

int AndroidHardwareBufferApi::RecvHandleFromUnixSocket(
    int aSocketFd, AHardwareBuffer** aOutBuffer) {
  return mAHardwareBuffer_recvHandleFromUnixSocket(aSocketFd, aOutBuffer);
}

/* static */
uint64_t AndroidHardwareBuffer::GetNextId() {
  static std::atomic<uint64_t> sNextId = 0;
  uint64_t id = ++sNextId;
  return id;
}

/* static */
already_AddRefed<AndroidHardwareBuffer> AndroidHardwareBuffer::Create(
    gfx::IntSize aSize, gfx::SurfaceFormat aFormat) {
  if (!AndroidHardwareBufferApi::Get()) {
    return nullptr;
  }

  if (aFormat != gfx::SurfaceFormat::R8G8B8A8 &&
      aFormat != gfx::SurfaceFormat::R8G8B8X8 &&
      aFormat != gfx::SurfaceFormat::B8G8R8A8 &&
      aFormat != gfx::SurfaceFormat::B8G8R8X8 &&
      aFormat != gfx::SurfaceFormat::R5G6B5_UINT16) {
    return nullptr;
  }

  AHardwareBuffer_Desc desc = {};
  desc.width = aSize.width;
  desc.height = aSize.height;
  desc.layers = 1;  // number of images
  desc.usage = AHARDWAREBUFFER_USAGE_CPU_READ_OFTEN |
               AHARDWAREBUFFER_USAGE_CPU_WRITE_OFTEN |
               AHARDWAREBUFFER_USAGE_GPU_SAMPLED_IMAGE |
               AHARDWAREBUFFER_USAGE_GPU_COLOR_OUTPUT;
  desc.format = ToAHardwareBuffer_Format(aFormat);

  AHardwareBuffer* nativeBuffer = nullptr;
  AndroidHardwareBufferApi::Get()->Allocate(&desc, &nativeBuffer);
  if (!nativeBuffer) {
    return nullptr;
  }

  AHardwareBuffer_Desc bufferInfo = {};
  AndroidHardwareBufferApi::Get()->Describe(nativeBuffer, &bufferInfo);

  RefPtr<AndroidHardwareBuffer> buffer = new AndroidHardwareBuffer(
      nativeBuffer, aSize, bufferInfo.stride, aFormat, GetNextId());
  AndroidHardwareBufferManager::Get()->Register(buffer);
  return buffer.forget();
}

AndroidHardwareBuffer::AndroidHardwareBuffer(AHardwareBuffer* aNativeBuffer,
                                             gfx::IntSize aSize,
                                             uint32_t aStride,
                                             gfx::SurfaceFormat aFormat,
                                             uint64_t aId)
    : mSize(aSize),
      mStride(aStride),
      mFormat(aFormat),
      mId(aId),
      mNativeBuffer(aNativeBuffer),
      mIsRegistered(false) {
  MOZ_ASSERT(mNativeBuffer);
#ifdef DEBUG
  AHardwareBuffer_Desc bufferInfo = {};
  AndroidHardwareBufferApi::Get()->Describe(mNativeBuffer, &bufferInfo);
  MOZ_ASSERT(mSize.width == (int32_t)bufferInfo.width);
  MOZ_ASSERT(mSize.height == (int32_t)bufferInfo.height);
  MOZ_ASSERT(mStride == bufferInfo.stride);
  MOZ_ASSERT(ToAHardwareBuffer_Format(mFormat) == bufferInfo.format);
#endif
}

AndroidHardwareBuffer::~AndroidHardwareBuffer() {
  if (mIsRegistered) {
    AndroidHardwareBufferManager::Get()->Unregister(this);
  }
  AndroidHardwareBufferApi::Get()->Release(mNativeBuffer);
}

int AndroidHardwareBuffer::Lock(uint64_t aUsage, const ARect* aRect,
                                void** aOutVirtualAddress) {
  UniqueFileHandle fd = GetAndResetReleaseFence();
  return AndroidHardwareBufferApi::Get()->Lock(mNativeBuffer, aUsage, fd.get(),
                                               aRect, aOutVirtualAddress);
}

int AndroidHardwareBuffer::Unlock() {
  int rawFd = -1;
  // XXX All tested recent Android devices did not return valid fence.
  int ret = AndroidHardwareBufferApi::Get()->Unlock(mNativeBuffer, &rawFd);
  if (ret != 0) {
    return ret;
  }

  SetAcquireFence(UniqueFileHandle(rawFd));
  return 0;
}

void AndroidHardwareBuffer::SetReleaseFence(UniqueFileHandle&& aFenceFd) {
  MonitorAutoLock lock(AndroidHardwareBufferManager::Get()->GetMonitor());
  SetReleaseFence(std::move(aFenceFd), lock);
}

void AndroidHardwareBuffer::SetReleaseFence(UniqueFileHandle&& aFenceFd,
                                            const MonitorAutoLock& aAutoLock) {
  mReleaseFenceFd = std::move(aFenceFd);
}

void AndroidHardwareBuffer::SetAcquireFence(UniqueFileHandle&& aFenceFd) {
  MonitorAutoLock lock(AndroidHardwareBufferManager::Get()->GetMonitor());

  mAcquireFenceFd = std::move(aFenceFd);
}

UniqueFileHandle AndroidHardwareBuffer::GetAndResetReleaseFence() {
  MonitorAutoLock lock(AndroidHardwareBufferManager::Get()->GetMonitor());
  return std::move(mReleaseFenceFd);
}

UniqueFileHandle AndroidHardwareBuffer::GetAndResetAcquireFence() {
  MonitorAutoLock lock(AndroidHardwareBufferManager::Get()->GetMonitor());
  return std::move(mAcquireFenceFd);
}

UniqueFileHandle AndroidHardwareBuffer::GetAcquireFence() const {
  MonitorAutoLock lock(AndroidHardwareBufferManager::Get()->GetMonitor());
  if (!mAcquireFenceFd) {
    return UniqueFileHandle();
  }

  return DuplicateFileHandle(mAcquireFenceFd);
}

StaticAutoPtr<AndroidHardwareBufferManager>
    AndroidHardwareBufferManager::sInstance;

/* static */
void AndroidHardwareBufferManager::Init() {
  MOZ_ASSERT(XRE_IsGPUProcess());

  sInstance = new AndroidHardwareBufferManager();
}

/* static */
void AndroidHardwareBufferManager::Shutdown() { sInstance = nullptr; }

AndroidHardwareBufferManager::AndroidHardwareBufferManager()
    : mMonitor("AndroidHardwareBufferManager.mMonitor") {}

void AndroidHardwareBufferManager::Register(
    RefPtr<AndroidHardwareBuffer> aBuffer) {
  MonitorAutoLock lock(mMonitor);

  aBuffer->mIsRegistered = true;
  ThreadSafeWeakPtr<AndroidHardwareBuffer> weak(aBuffer);

#ifdef DEBUG
  const auto it = mBuffers.find(aBuffer->mId);
  MOZ_ASSERT(it == mBuffers.end());
#endif
  mBuffers.emplace(aBuffer->mId, weak);
}

void AndroidHardwareBufferManager::Unregister(AndroidHardwareBuffer* aBuffer) {
  MonitorAutoLock lock(mMonitor);

  const auto it = mBuffers.find(aBuffer->mId);
  MOZ_ASSERT(it != mBuffers.end());
  if (it == mBuffers.end()) {
    gfxCriticalNote << "AndroidHardwareBuffer id mismatch happened";
    return;
  }
  mBuffers.erase(it);
}

already_AddRefed<AndroidHardwareBuffer> AndroidHardwareBufferManager::GetBuffer(
    uint64_t aBufferId) {
  MonitorAutoLock lock(mMonitor);

  const auto it = mBuffers.find(aBufferId);
  if (it == mBuffers.end()) {
    return nullptr;
  }
  auto buffer = RefPtr<AndroidHardwareBuffer>(it->second);
  return buffer.forget();
}

}  // namespace layers
}  // namespace mozilla
