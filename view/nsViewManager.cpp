/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsViewManager.h"

#include "mozilla/MouseEvents.h"
#include "mozilla/PresShell.h"
#include "mozilla/PresShellInlines.h"
#include "mozilla/Preferences.h"
#include "mozilla/ProfilerLabels.h"
#include "mozilla/StartupTimeline.h"
#include "mozilla/dom/Document.h"
#include "nsGfxCIID.h"
#include "nsView.h"
#include "nsCOMPtr.h"
#include "nsRegion.h"
#include "nsCOMArray.h"
#include "nsXULPopupManager.h"
#include "nsPresContext.h"
#include "nsRefreshDriver.h"
#include "nsContentUtils.h"  // for nsAutoScriptBlocker
#include "nsLayoutUtils.h"
#include "gfxPlatform.h"
#include "WindowRenderer.h"

/**
   XXX TODO XXX

   DeCOMify newly private methods
   Optimize view storage
*/

/**
   A note about platform assumptions:

   We assume that a widget is z-ordered on top of its parent.

   We do NOT assume anything about the relative z-ordering of sibling widgets.
   Even though we ask for a specific z-order, we don't assume that widget
   z-ordering actually works.
*/

using namespace mozilla;
using namespace mozilla::layers;

#define NSCOORD_NONE INT32_MIN

#undef DEBUG_MOUSE_LOCATION

uint32_t nsViewManager::gLastUserEventTime = 0;

nsViewManager::nsViewManager()
    : mPresShell(nullptr),
      mDelayedResize(NSCOORD_NONE, NSCOORD_NONE),
      mRootView(nullptr),
      mRefreshDisableCount(0),
      mPainting(false),
      mRecursiveRefreshPending(false),
      mHasPendingWidgetGeometryChanges(false) {}

nsViewManager::~nsViewManager() {
  if (mRootView) {
    // Destroy any remaining views
    mRootView->Destroy();
    mRootView = nullptr;
  }

  mRootViewManager = nullptr;

  MOZ_RELEASE_ASSERT(!mPresShell,
                     "Releasing nsViewManager without having called Destroy on "
                     "the PresShell!");
}

// We don't hold a reference to the presentation context because it
// holds a reference to us.
nsresult nsViewManager::Init(nsDeviceContext* aContext) {
  MOZ_ASSERT(nullptr != aContext, "null ptr");

  if (nullptr == aContext) {
    return NS_ERROR_NULL_POINTER;
  }
  if (nullptr != mContext) {
    return NS_ERROR_ALREADY_INITIALIZED;
  }
  mContext = aContext;

  return NS_OK;
}

nsView* nsViewManager::CreateView(const nsRect& aBounds, nsView* aParent,
                                  ViewVisibility aVisibilityFlag) {
  auto* v = new nsView(this, aVisibilityFlag);
  v->SetParent(aParent);
  v->SetPosition(aBounds.X(), aBounds.Y());
  nsRect dim(0, 0, aBounds.Width(), aBounds.Height());
  v->SetDimensions(dim, false);
  return v;
}

void nsViewManager::SetRootView(nsView* aView) {
  MOZ_ASSERT(!aView || aView->GetViewManager() == this,
             "Unexpected viewmanager on root view");

  // Do NOT destroy the current root view. It's the caller's responsibility
  // to destroy it
  mRootView = aView;

  if (mRootView) {
    nsView* parent = mRootView->GetParent();
    if (parent) {
      // Calling InsertChild on |parent| will InvalidateHierarchy() on us, so
      // no need to set mRootViewManager ourselves here.
      parent->InsertChild(mRootView, nullptr);
    } else {
      InvalidateHierarchy();
    }
  }
  // Else don't touch mRootViewManager
}

void nsViewManager::GetWindowDimensions(nscoord* aWidth, nscoord* aHeight) {
  if (nullptr != mRootView) {
    if (mDelayedResize == nsSize(NSCOORD_NONE, NSCOORD_NONE)) {
      nsRect dim = mRootView->GetDimensions();
      *aWidth = dim.Width();
      *aHeight = dim.Height();
    } else {
      *aWidth = mDelayedResize.width;
      *aHeight = mDelayedResize.height;
    }
  } else {
    *aWidth = 0;
    *aHeight = 0;
  }
}

void nsViewManager::DoSetWindowDimensions(nscoord aWidth, nscoord aHeight) {
  nsRect oldDim = mRootView->GetDimensions();
  nsRect newDim(0, 0, aWidth, aHeight);
  // We care about resizes even when one dimension is already zero.
  if (oldDim.IsEqualEdges(newDim)) {
    return;
  }
  // Don't resize the widget. It is already being set elsewhere.
  mRootView->SetDimensions(newDim, true, false);
  if (RefPtr<PresShell> presShell = mPresShell) {
    presShell->ResizeReflow(aWidth, aHeight);
  }
}

bool nsViewManager::ShouldDelayResize() const {
  MOZ_ASSERT(mRootView);
  if (!mRootView->IsEffectivelyVisible() || !mPresShell ||
      !mPresShell->IsVisible()) {
    return true;
  }
  if (nsRefreshDriver* rd = mPresShell->GetRefreshDriver()) {
    if (rd->IsResizeSuppressed()) {
      return true;
    }
  }
  return false;
}

void nsViewManager::SetWindowDimensions(nscoord aWidth, nscoord aHeight,
                                        bool aDelayResize) {
  if (mRootView) {
    if (!ShouldDelayResize() && !aDelayResize) {
      if (mDelayedResize != nsSize(NSCOORD_NONE, NSCOORD_NONE) &&
          mDelayedResize != nsSize(aWidth, aHeight)) {
        // We have a delayed resize; that now obsolete size may already have
        // been flushed to the PresContext so we need to update the PresContext
        // with the new size because if the new size is exactly the same as the
        // root view's current size then DoSetWindowDimensions will not
        // request a resize reflow (which would correct it). See bug 617076.
        mDelayedResize = nsSize(aWidth, aHeight);
        FlushDelayedResize();
      }
      mDelayedResize.SizeTo(NSCOORD_NONE, NSCOORD_NONE);
      DoSetWindowDimensions(aWidth, aHeight);
    } else {
      mDelayedResize.SizeTo(aWidth, aHeight);
      if (mPresShell) {
        mPresShell->SetNeedStyleFlush();
        mPresShell->SetNeedLayoutFlush();
      }
    }
  }
}

void nsViewManager::FlushDelayedResize() {
  if (mDelayedResize != nsSize(NSCOORD_NONE, NSCOORD_NONE)) {
    DoSetWindowDimensions(mDelayedResize.width, mDelayedResize.height);
    mDelayedResize.SizeTo(NSCOORD_NONE, NSCOORD_NONE);
  }
}

// Convert aIn from being relative to and in appunits of aFromView, to being
// relative to and in appunits of aToView.
static nsRect ConvertRectBetweenViews(const nsRect& aIn, nsView* aFromView,
                                      nsView* aToView) {
  nsRect out = aIn;
  out.MoveBy(aFromView->GetOffsetTo(aToView));
  out = out.ScaleToOtherAppUnitsRoundOut(
      aFromView->GetViewManager()->AppUnitsPerDevPixel(),
      aToView->GetViewManager()->AppUnitsPerDevPixel());
  return out;
}

nsView* nsViewManager::GetDisplayRootFor(nsView* aView) {
  nsView* displayRoot = aView;
  for (;;) {
    nsView* displayParent = displayRoot->GetParent();
    if (!displayParent) {
      return displayRoot;
    }

    // Any popup view is a display root.
    if (displayRoot->GetFrame() &&
        displayRoot->GetFrame()->IsMenuPopupFrame()) {
      return displayRoot;
    }

    displayRoot = displayParent;
  }
}

/**
   aRegion is given in device coordinates!!
   aContext may be null, in which case layers should be used for
   rendering.
*/
void nsViewManager::Refresh(nsView* aView,
                            const LayoutDeviceIntRegion& aRegion) {
  NS_ASSERTION(aView->GetViewManager() == this, "wrong view manager");

  if (mPresShell && mPresShell->IsNeverPainting()) {
    return;
  }

  if (aRegion.IsEmpty()) {
    return;
  }

  nsIWidget* widget = aView->GetWidget();
  if (!widget) {
    return;
  }

  NS_ASSERTION(!IsPainting(), "recursive painting not permitted");
  if (IsPainting()) {
    RootViewManager()->mRecursiveRefreshPending = true;
    return;
  }

  {
    nsAutoScriptBlocker scriptBlocker;
    SetPainting(true);

    NS_ASSERTION(GetDisplayRootFor(aView) == aView,
                 "Widgets that we paint must all be display roots");

    if (RefPtr<PresShell> presShell = mPresShell) {
#ifdef MOZ_DUMP_PAINTING
      if (nsLayoutUtils::InvalidationDebuggingIsEnabled()) {
        printf_stderr("--COMPOSITE-- %p\n", presShell.get());
      }
#endif
      WindowRenderer* renderer = widget->GetWindowRenderer();
      if (!renderer->NeedsWidgetInvalidation()) {
        renderer->FlushRendering(wr::RenderReasons::WIDGET);
      } else {
        presShell->SyncPaintFallback(aView);
      }
#ifdef MOZ_DUMP_PAINTING
      if (nsLayoutUtils::InvalidationDebuggingIsEnabled()) {
        printf_stderr("--ENDCOMPOSITE--\n");
      }
#endif
      mozilla::StartupTimeline::RecordOnce(
          mozilla::StartupTimeline::FIRST_PAINT);
    }

    SetPainting(false);
  }

  if (RootViewManager()->mRecursiveRefreshPending) {
    RootViewManager()->mRecursiveRefreshPending = false;
    InvalidateAllViews();
  }
}

void nsViewManager::ProcessPendingUpdatesForView(nsView* aView,
                                                 bool aFlushDirtyRegion) {
  NS_ASSERTION(IsRootVM(), "Updates will be missed");
  if (!aView) {
    return;
  }

  RefPtr<PresShell> rootPresShell = mPresShell;
  AutoTArray<nsCOMPtr<nsIWidget>, 1> widgets;
  aView->GetViewManager()->ProcessPendingUpdatesRecurse(aView, widgets);
  for (uint32_t i = 0; i < widgets.Length(); ++i) {
    nsView* view = nsView::GetViewFor(widgets[i]);
    if (view) {
      if (view->mNeedsWindowPropertiesSync) {
        view->mNeedsWindowPropertiesSync = false;
        if (nsViewManager* vm = view->GetViewManager()) {
          if (PresShell* presShell = vm->GetPresShell()) {
            presShell->SyncWindowProperties(/* aSync */ true);
          }
        }
      }
    }
    view = nsView::GetViewFor(widgets[i]);
    if (view) {
      view->ResetWidgetBounds(false, true);
    }
  }
  if (rootPresShell->GetViewManager() != this) {
    return;  // presentation might have been torn down
  }
  if (aFlushDirtyRegion) {
    nsAutoScriptBlocker scriptBlocker;
    SetPainting(true);
    for (uint32_t i = 0; i < widgets.Length(); ++i) {
      nsIWidget* widget = widgets[i];
      nsView* view = nsView::GetViewFor(widget);
      if (view) {
        RefPtr<nsViewManager> viewManager = view->GetViewManager();
        viewManager->ProcessPendingUpdatesPaint(MOZ_KnownLive(widget));
      }
    }
    SetPainting(false);
  }
}

void nsViewManager::ProcessPendingUpdatesRecurse(
    nsView* aView, AutoTArray<nsCOMPtr<nsIWidget>, 1>& aWidgets) {
  if (mPresShell && mPresShell->IsNeverPainting()) {
    return;
  }

  for (nsView* childView = aView->GetFirstChild(); childView;
       childView = childView->GetNextSibling()) {
    childView->GetViewManager()->ProcessPendingUpdatesRecurse(childView,
                                                              aWidgets);
  }

  nsIWidget* widget = aView->GetWidget();
  if (widget) {
    aWidgets.AppendElement(widget);
  } else {
    FlushDirtyRegionToWidget(aView);
  }
}

void nsViewManager::ProcessPendingUpdatesPaint(nsIWidget* aWidget) {
  if (aWidget->NeedsPaint()) {
    // If an ancestor widget was hidden and then shown, we could
    // have a delayed resize to handle.
    for (RefPtr<nsViewManager> vm = this; vm;
         vm = vm->mRootView->GetParent()
                  ? vm->mRootView->GetParent()->GetViewManager()
                  : nullptr) {
      if (vm->mDelayedResize != nsSize(NSCOORD_NONE, NSCOORD_NONE) &&
          vm->mRootView->IsEffectivelyVisible() && vm->mPresShell &&
          vm->mPresShell->IsVisible()) {
        vm->FlushDelayedResize();
      }
    }
    nsView* view = nsView::GetViewFor(aWidget);

    if (!view) {
      NS_ERROR("FlushDelayedResize destroyed the nsView?");
      return;
    }

    nsIWidgetListener* previousListener =
        aWidget->GetPreviouslyAttachedWidgetListener();

    if (previousListener && previousListener != view &&
        view->IsPrimaryFramePaintSuppressed()) {
      return;
    }

    if (RefPtr<PresShell> presShell = mPresShell) {
#ifdef MOZ_DUMP_PAINTING
      if (nsLayoutUtils::InvalidationDebuggingIsEnabled()) {
        printf_stderr(
            "---- PAINT START ----PresShell(%p), nsView(%p), nsIWidget(%p)\n",
            presShell.get(), view, aWidget);
      }
#endif

      presShell->PaintAndRequestComposite(view, PaintFlags::None);
      view->SetForcedRepaint(false);

#ifdef MOZ_DUMP_PAINTING
      if (nsLayoutUtils::InvalidationDebuggingIsEnabled()) {
        printf_stderr("---- PAINT END ----\n");
      }
#endif
    }
  }
  FlushDirtyRegionToWidget(nsView::GetViewFor(aWidget));
}

void nsViewManager::FlushDirtyRegionToWidget(nsView* aView) {
  NS_ASSERTION(aView->GetViewManager() == this,
               "FlushDirtyRegionToWidget called on view we don't own");

  if (!aView->IsDirty()) {
    return;
  }

  const nsRect dirtyRegion = aView->GetDimensions();
  nsView* nearestViewWithWidget = aView;
  while (!nearestViewWithWidget->HasWidget() &&
         nearestViewWithWidget->GetParent()) {
    nearestViewWithWidget = nearestViewWithWidget->GetParent();
  }
  nsRect r = ConvertRectBetweenViews(dirtyRegion, aView, nearestViewWithWidget);
  nsViewManager* widgetVM = nearestViewWithWidget->GetViewManager();
  widgetVM->InvalidateWidgetArea(nearestViewWithWidget, r);
  aView->SetIsDirty(false);
}

void nsViewManager::PostPendingUpdate() {
  nsViewManager* rootVM = RootViewManager();
  rootVM->mHasPendingWidgetGeometryChanges = true;
  if (rootVM->mPresShell) {
    rootVM->mPresShell->SetNeedLayoutFlush();
    rootVM->mPresShell->SchedulePaint();
  }
}

/**
 * @param aDamagedRegion this region, relative to aWidgetView, is invalidated in
 * every widget child of aWidgetView, plus aWidgetView's own widget
 */
void nsViewManager::InvalidateWidgetArea(nsView* aWidgetView,
                                         const nsRegion& aDamagedRegion) {
  NS_ASSERTION(aWidgetView->GetViewManager() == this,
               "InvalidateWidgetArea called on view we don't own");
  nsIWidget* widget = aWidgetView->GetWidget();

#if 0
  nsRect dbgBounds = aDamagedRegion.GetBounds();
  printf("InvalidateWidgetArea view:%X (%d) widget:%X region: %d, %d, %d, %d\n",
    aWidgetView, aWidgetView->IsAttachedToTopLevel(),
    widget, dbgBounds.x, dbgBounds.y, dbgBounds.width, dbgBounds.height);
#endif

  // If the widget is hidden, it don't cover nothing
  if (widget && !widget->IsVisible()) {
    return;
  }

  if (!widget) {
    // The root view or a scrolling view might not have a widget
    // (for example, during printing). We get here when we scroll
    // during printing to show selected options in a listbox, for example.
    return;
  }

  if (!aDamagedRegion.IsEmpty()) {
    for (auto iter = aDamagedRegion.RectIter(); !iter.Done(); iter.Next()) {
      LayoutDeviceIntRect bounds = ViewToWidget(aWidgetView, iter.Get());
      widget->Invalidate(bounds);
    }
  }
}

static bool ShouldIgnoreInvalidation(nsViewManager* aVM) {
  while (aVM) {
    PresShell* presShell = aVM->GetPresShell();
    if (!presShell || presShell->ShouldIgnoreInvalidation()) {
      return true;
    }
    nsView* view = aVM->GetRootView()->GetParent();
    aVM = view ? view->GetViewManager() : nullptr;
  }
  return false;
}

void nsViewManager::InvalidateView(nsView* aView) {
  // If painting is suppressed in the presshell or an ancestor drop all
  // invalidates, it will invalidate everything when it unsuppresses.
  if (ShouldIgnoreInvalidation(this)) {
    return;
  }

  NS_ASSERTION(aView->GetViewManager() == this,
               "InvalidateView called on view we don't own");

  if (aView->GetBounds().IsEmpty()) {
    return;
  }
  GetDisplayRootFor(aView)->SetIsDirty(true);
}

void nsViewManager::InvalidateAllViews() {
  if (RootViewManager() != this) {
    return RootViewManager()->InvalidateAllViews();
  }

  InvalidateViews(mRootView);
}

void nsViewManager::InvalidateViews(nsView* aView) {
  // Invalidate this view.
  InvalidateView(aView);

  // Invalidate all children as well.
  nsView* childView = aView->GetFirstChild();
  while (nullptr != childView) {
    childView->GetViewManager()->InvalidateViews(childView);
    childView = childView->GetNextSibling();
  }
}

void nsViewManager::WillPaintWindow(nsIWidget* aWidget) {
  if (aWidget) {
    nsView* view = nsView::GetViewFor(aWidget);
    WindowRenderer* renderer = aWidget->GetWindowRenderer();
    if (view &&
        (view->ForcedRepaint() || !renderer->NeedsWidgetInvalidation())) {
      ProcessPendingUpdates();
      // Re-get the view pointer here since the ProcessPendingUpdates might have
      // destroyed it during CallWillPaintOnObservers.
      view = nsView::GetViewFor(aWidget);
      if (view) {
        view->SetForcedRepaint(false);
      }
    }
  }
}

bool nsViewManager::PaintWindow(nsIWidget* aWidget,
                                const LayoutDeviceIntRegion& aRegion) {
  if (!aWidget || !mContext) return false;

  NS_ASSERTION(
      IsPaintingAllowed(),
      "shouldn't be receiving paint events while painting is disallowed!");

  // Get the view pointer here since NS_WILL_PAINT might have
  // destroyed it during CallWillPaintOnObservers (bug 378273).
  nsView* view = nsView::GetViewFor(aWidget);
  if (view && !aRegion.IsEmpty()) {
    Refresh(view, aRegion);
  }

  return true;
}

void nsViewManager::DidPaintWindow() {
  if (RefPtr<PresShell> presShell = mPresShell) {
    presShell->DidPaintWindow();
  }
}

void nsViewManager::DispatchEvent(WidgetGUIEvent* aEvent, nsView* aView,
                                  nsEventStatus* aStatus) {
  AUTO_PROFILER_LABEL("nsViewManager::DispatchEvent", OTHER);

  WidgetMouseEvent* mouseEvent = aEvent->AsMouseEvent();
  if ((mouseEvent &&
       // Ignore mouse events that we synthesize.
       mouseEvent->mReason == WidgetMouseEvent::eReal &&
       // Ignore mouse exit and enter (we'll get moves if the user
       // is really moving the mouse) since we get them when we
       // create and destroy widgets.
       mouseEvent->mMessage != eMouseExitFromWidget &&
       mouseEvent->mMessage != eMouseEnterIntoWidget) ||
      aEvent->HasKeyEventMessage() || aEvent->HasIMEEventMessage()) {
    gLastUserEventTime = PR_IntervalToMicroseconds(PR_IntervalNow());
  }

  // Find the view whose coordinates system we're in.
  nsView* view = aView;
  bool dispatchUsingCoordinates = aEvent->IsUsingCoordinates();
  if (dispatchUsingCoordinates) {
    // Will dispatch using coordinates. Pretty bogus but it's consistent
    // with what presshell does.
    view = GetDisplayRootFor(view);
  }

  // If the view has no frame, look for a view that does.
  nsIFrame* frame = view->GetFrame();
  if (!frame && (dispatchUsingCoordinates || aEvent->HasKeyEventMessage() ||
                 aEvent->IsIMERelatedEvent())) {
    while (view && !view->GetFrame()) {
      view = view->GetParent();
    }

    if (view) {
      frame = view->GetFrame();
    }
  }

  if (nullptr != frame) {
    // Hold a refcount to the presshell. The continued existence of the
    // presshell will delay deletion of this view hierarchy should the event
    // want to cause its destruction in, say, some JavaScript event handler.
    if (RefPtr<PresShell> presShell = view->GetViewManager()->GetPresShell()) {
      presShell->HandleEvent(frame, aEvent, false, aStatus);
      return;
    }
  }

  *aStatus = nsEventStatus_eIgnore;
}

void nsViewManager::InsertChild(nsView* aParent, nsView* aChild,
                                nsView* aSibling, bool aAfter) {
  MOZ_ASSERT(nullptr != aParent, "null ptr");
  MOZ_ASSERT(nullptr != aChild, "null ptr");
  NS_ASSERTION(aSibling == nullptr || aSibling->GetParent() == aParent,
               "tried to insert view with invalid sibling");
  NS_ASSERTION(!IsViewInserted(aChild),
               "tried to insert an already-inserted view");

  if ((nullptr != aParent) && (nullptr != aChild)) {
    // if aAfter is set, we will insert the child after 'prev' (i.e. after 'kid'
    // in document order, otherwise after 'kid' (i.e. before 'kid' in document
    // order).

    if (nullptr == aSibling) {
      if (aAfter) {
        // insert at end of document order, i.e., before first view
        // this is the common case, by far
        aParent->InsertChild(aChild, nullptr);
      } else {
        // insert at beginning of document order, i.e., after last view
        nsView* kid = aParent->GetFirstChild();
        nsView* prev = nullptr;
        while (kid) {
          prev = kid;
          kid = kid->GetNextSibling();
        }
        // prev is last view or null if there are no children
        aParent->InsertChild(aChild, prev);
      }
    } else {
      nsView* kid = aParent->GetFirstChild();
      nsView* prev = nullptr;
      while (kid && aSibling != kid) {
        // get the next sibling view
        prev = kid;
        kid = kid->GetNextSibling();
      }
      NS_ASSERTION(kid != nullptr, "couldn't find sibling in child list");
      if (aAfter) {
        // insert after 'kid' in document order, i.e. before in view order
        aParent->InsertChild(aChild, prev);
      } else {
        // insert before 'kid' in document order, i.e. after in view order
        aParent->InsertChild(aChild, kid);
      }
    }
  }
}

void nsViewManager::RemoveChild(nsView* aChild) {
  NS_ASSERTION(aChild, "aChild must not be null");

  nsView* parent = aChild->GetParent();

  if (nullptr != parent) {
    NS_ASSERTION(
        aChild->GetViewManager() == this || parent->GetViewManager() == this,
        "wrong view manager");
    parent->RemoveChild(aChild);
  }
}

void nsViewManager::MoveViewTo(nsView* aView, nscoord aX, nscoord aY) {
  NS_ASSERTION(aView->GetViewManager() == this, "wrong view manager");
  aView->SetPosition(aX, aY);
}

void nsViewManager::ResizeView(nsView* aView, const nsRect& aRect) {
  NS_ASSERTION(aView->GetViewManager() == this, "wrong view manager");

  nsRect oldDimensions = aView->GetDimensions();
  if (!oldDimensions.IsEqualEdges(aRect)) {
    aView->SetDimensions(aRect, true);
  }

  // Note that if layout resizes the view and the view has a custom clip
  // region set, then we expect layout to update the clip region too. Thus
  // in the case where mClipRect has been optimized away to just be a null
  // pointer, and this resize is implicitly changing the clip rect, it's OK
  // because layout will change it back again if necessary.
}

void nsViewManager::SetViewVisibility(nsView* aView, ViewVisibility aVisible) {
  NS_ASSERTION(aView->GetViewManager() == this, "wrong view manager");

  if (aVisible != aView->GetVisibility()) {
    aView->SetVisibility(aVisible);
  }
}

bool nsViewManager::IsViewInserted(nsView* aView) {
  if (mRootView == aView) {
    return true;
  }
  if (aView->GetParent() == nullptr) {
    return false;
  }
  nsView* view = aView->GetParent()->GetFirstChild();
  while (view != nullptr) {
    if (view == aView) {
      return true;
    }
    view = view->GetNextSibling();
  }
  return false;
}

nsViewManager* nsViewManager::IncrementDisableRefreshCount() {
  if (!IsRootVM()) {
    return RootViewManager()->IncrementDisableRefreshCount();
  }

  ++mRefreshDisableCount;

  return this;
}

void nsViewManager::DecrementDisableRefreshCount() {
  NS_ASSERTION(IsRootVM(), "Should only be called on root");
  --mRefreshDisableCount;
  NS_ASSERTION(mRefreshDisableCount >= 0, "Invalid refresh disable count!");
}

nsIWidget* nsViewManager::GetRootWidget() const {
  if (!mRootView) {
    return nullptr;
  }
  if (mRootView->HasWidget()) {
    return mRootView->GetWidget();
  }
  if (mRootView->GetParent()) {
    return mRootView->GetParent()->GetViewManager()->GetRootWidget();
  }
  return nullptr;
}

LayoutDeviceIntRect nsViewManager::ViewToWidget(nsView* aView,
                                                const nsRect& aRect) const {
  NS_ASSERTION(aView->GetViewManager() == this, "wrong view manager");

  // account for the view's origin not lining up with the widget's
  nsRect rect = aRect + aView->ViewToWidgetOffset();

  // finally, convert to device coordinates.
  return LayoutDeviceIntRect::FromUnknownRect(
      rect.ToOutsidePixels(AppUnitsPerDevPixel()));
}

void nsViewManager::IsPainting(bool& aIsPainting) {
  aIsPainting = IsPainting();
}

void nsViewManager::ProcessPendingUpdates() {
  if (!IsRootVM()) {
    RefPtr<nsViewManager> rootViewManager = RootViewManager();
    rootViewManager->ProcessPendingUpdates();
    return;
  }

  // Flush things like reflows by calling WillPaint on observer presShells.
  if (mPresShell) {
    RefPtr<nsViewManager> strongThis(this);
    CallWillPaintOnObservers();

    ProcessPendingUpdatesForView(mRootView, true);
  }
}

void nsViewManager::UpdateWidgetGeometry() {
  if (!IsRootVM()) {
    RefPtr<nsViewManager> rootViewManager = RootViewManager();
    rootViewManager->UpdateWidgetGeometry();
    return;
  }

  if (mHasPendingWidgetGeometryChanges) {
    mHasPendingWidgetGeometryChanges = false;
    ProcessPendingUpdatesForView(mRootView, false);
  }
}

/* static */ void nsViewManager::CollectVMsForWillPaint(
    nsView* aView, nsViewManager* aParentVM,
    nsTArray<RefPtr<nsViewManager>>& aVMs) {
  nsViewManager* vm = aView->GetViewManager();
  if (vm != aParentVM) {
    aVMs.AppendElement(vm);
  }

  for (nsView* child = aView->GetFirstChild(); child;
       child = child->GetNextSibling()) {
    CollectVMsForWillPaint(child, vm, aVMs);
  }
}

void nsViewManager::CallWillPaintOnObservers() {
  MOZ_ASSERT(IsRootVM(), "Must be root VM for this to be called!");

  if (!mRootView) {
    return;
  }

  AutoTArray<RefPtr<nsViewManager>, 2> VMs;
  CollectVMsForWillPaint(mRootView, nullptr, VMs);
  for (const auto& vm : VMs) {
    if (vm->GetRootView() && vm->GetRootView()->IsEffectivelyVisible()) {
      if (RefPtr<PresShell> presShell = vm->GetPresShell()) {
        presShell->WillPaint();
      }
    }
  }
}

void nsViewManager::GetLastUserEventTime(uint32_t& aTime) {
  aTime = gLastUserEventTime;
}

void nsViewManager::InvalidateHierarchy() {
  if (mRootView) {
    mRootViewManager = nullptr;
    nsView* parent = mRootView->GetParent();
    if (parent) {
      mRootViewManager = parent->GetViewManager()->RootViewManager();
      NS_ASSERTION(mRootViewManager != this,
                   "Root view had a parent, but it has the same view manager");
    }
    // else, we are implicitly our own root view manager.
  }
}
