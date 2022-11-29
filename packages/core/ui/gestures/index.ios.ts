// Definitions.
import { GestureEventData, TapGestureEventData, GestureEventDataWithState, SwipeGestureEventData, PanGestureEventData, RotationGestureEventData, PinchGestureEventData } from '.';
import { View } from '../core/view';
import { DOMEvent } from '../../data/dom-events/dom-event';
import { EventData } from '../../data/observable';

// Types.
import { GesturesObserverBase, toString, TouchAction, GestureStateTypes, GestureTypes, SwipeDirection, GestureEvents } from './gestures-common';

// Import layout from utils directly to avoid circular references
import { layout } from '../../utils';

export * from './gestures-common';

@NativeClass
class UIGestureRecognizerDelegateImpl extends NSObject implements UIGestureRecognizerDelegate {
	public static ObjCProtocols = [UIGestureRecognizerDelegate];

	public gestureRecognizerShouldRecognizeSimultaneouslyWithGestureRecognizer(gestureRecognizer: UIGestureRecognizer, otherGestureRecognizer: UIGestureRecognizer): boolean {
		return true;
	}

	public gestureRecognizerShouldRequireFailureOfGestureRecognizer(gestureRecognizer: UIGestureRecognizer, otherGestureRecognizer: UIGestureRecognizer): boolean {
		// If both gesture recognizers are of type UITapGestureRecognizer & one of them is a doubleTap,
		// we must require a failure.
		if (gestureRecognizer instanceof UITapGestureRecognizer && otherGestureRecognizer instanceof UITapGestureRecognizer && otherGestureRecognizer.numberOfTapsRequired === 2) {
			return true;
		}

		return false;
	}
}
const recognizerDelegateInstance: UIGestureRecognizerDelegateImpl = <UIGestureRecognizerDelegateImpl>UIGestureRecognizerDelegateImpl.new();

@NativeClass
class UIGestureRecognizerImpl extends NSObject {
	public static ObjCExposedMethods = {
		recognize: {
			returns: interop.types.void,
			params: [UIGestureRecognizer],
		},
	};

	private _owner: WeakRef<GesturesObserver>;
	private _type: any;
	private _callback: (args: GestureEventData) => void;
	private _context: any;

	public static initWithOwnerTypeCallback(owner: WeakRef<GesturesObserver>, type: any, callback?: (args: GestureEventData) => void, thisArg?: any): UIGestureRecognizerImpl {
		const handler = <UIGestureRecognizerImpl>UIGestureRecognizerImpl.new();
		handler._owner = owner;
		handler._type = type;

		if (callback) {
			handler._callback = callback;
		}

		if (thisArg) {
			handler._context = thisArg;
		}

		return handler;
	}

	public recognize(recognizer: UIGestureRecognizer): void {
		const owner = this._owner?.deref();
		const callback = this._callback ? this._callback : owner ? owner.callback : null;
		const typeParam = this._type;
		const target = owner ? owner.target : undefined;

		const args = {
			type: typeParam,
			view: target,
			ios: recognizer,
			android: undefined,
			object: target,
			eventName: toString(typeParam),
		};

		if (callback) {
			callback.call(this._context, args);
		}
	}
}

export class GesturesObserver extends GesturesObserverBase {
	private _recognizers: { [name: string]: RecognizerCache };

	private _onTargetLoaded: (data: EventData) => void;
	private _onTargetUnloaded: (data: EventData) => void;

	constructor(target: View, callback: (args: GestureEventData) => void, context: any) {
		super(target, callback, context);
		this._recognizers = {};
	}

	public androidOnTouchEvent(motionEvent: unknown): void {
		// Android-only, so no-op.
	}

	public observe(type: GestureTypes) {
		if (!this.target) {
			return;
		}

		this.type = type;
		this._onTargetLoaded = (args) => {
			this._attach(this.target, type);
		};
		this._onTargetUnloaded = (args) => {
			this._detach();
		};

		this.target.on('loaded', this._onTargetLoaded);
		this.target.on('unloaded', this._onTargetUnloaded);

		if (this.target.isLoaded) {
			this._attach(this.target, type);
		}
	}

	private _attach(target: View, type: GestureTypes) {
		this._detach();

		if (!target?.nativeViewProtected?.addGestureRecognizer) {
			return;
		}

		const nativeView = target.nativeViewProtected as UIView;

		// For each of these gesture types (except for touch, as it's not very
		// useful), we dispatch non-cancelable, non-bubbling DOM events (for
		// consistency with the original behaviour of observers). In a breaking
		// release, we may make them bubbling.

		if (type & GestureTypes.tap) {
			nativeView.addGestureRecognizer(
				this._createRecognizer(
					GestureTypes.tap,
					(args) =>
						args.view &&
						new DOMEvent('tap').dispatchTo({
							target: args.view as View,
							data: _getTapData(args),
						})
				)
			);
		}

		if (type & GestureTypes.doubleTap) {
			nativeView.addGestureRecognizer(
				this._createRecognizer(
					GestureTypes.doubleTap,
					(args) =>
						args.view &&
						new DOMEvent('doubleTap').dispatchTo({
							target: args.view as View,
							data: _getTapData(args),
						})
				)
			);
		}

		if (type & GestureTypes.pinch) {
			nativeView.addGestureRecognizer(
				this._createRecognizer(
					GestureTypes.pinch,
					(args) =>
						args.view &&
						new DOMEvent('pinch').dispatchTo({
							target: args.view as View,
							data: _getPinchData(args),
						})
				)
			);
		}

		if (type & GestureTypes.pan) {
			nativeView.addGestureRecognizer(
				this._createRecognizer(
					GestureTypes.pan,
					(args) =>
						args.view &&
						new DOMEvent('pan').dispatchTo({
							target: args.view as View,
							data: _getPanData(args, target.nativeViewProtected),
						})
				)
			);
		}

		if (type & GestureTypes.swipe) {
			nativeView.addGestureRecognizer(
				this._createRecognizer(
					GestureTypes.swipe,
					(args) =>
						args.view &&
						new DOMEvent('swipe').dispatchTo({
							target: args.view as View,
							data: _getSwipeData(args),
						}),
					UISwipeGestureRecognizerDirection.Down
				)
			);

			nativeView.addGestureRecognizer(
				this._createRecognizer(
					GestureTypes.swipe,
					(args) =>
						args.view &&
						new DOMEvent('swipe').dispatchTo({
							target: args.view as View,
							data: _getSwipeData(args),
						}),
					UISwipeGestureRecognizerDirection.Left
				)
			);

			nativeView.addGestureRecognizer(
				this._createRecognizer(
					GestureTypes.swipe,
					(args) =>
						args.view &&
						new DOMEvent('swipe').dispatchTo({
							target: args.view as View,
							data: _getSwipeData(args),
						}),
					UISwipeGestureRecognizerDirection.Right
				)
			);

			nativeView.addGestureRecognizer(
				this._createRecognizer(
					GestureTypes.swipe,
					(args) =>
						args.view &&
						new DOMEvent('swipe').dispatchTo({
							target: args.view as View,
							data: _getSwipeData(args),
						}),
					UISwipeGestureRecognizerDirection.Up
				)
			);
		}

		if (type & GestureTypes.rotation) {
			nativeView.addGestureRecognizer(
				this._createRecognizer(
					GestureTypes.rotation,
					(args) =>
						args.view &&
						new DOMEvent('rotation').dispatchTo({
							target: args.view as View,
							data: _getRotationData(args),
						})
				)
			);
		}

		if (type & GestureTypes.longPress) {
			nativeView.addGestureRecognizer(
				this._createRecognizer(
					GestureTypes.longPress,
					(args) =>
						args.view &&
						new DOMEvent('longPress').dispatchTo({
							target: args.view as View,
							data: _getLongPressData(args),
						})
				)
			);
		}

		if (type & GestureTypes.touch) {
			nativeView.addGestureRecognizer(this._createRecognizer(GestureTypes.touch));
		}
	}

	private _detach() {
		if (!this.target?.nativeViewProtected) {
			return;
		}

		for (const name in this._recognizers) {
			if (this._recognizers.hasOwnProperty(name)) {
				const item = <RecognizerCache>this._recognizers[name];
				this.target.nativeViewProtected.removeGestureRecognizer(item.recognizer);

				item.recognizer = null;
				item.target = null;
			}
		}
		this._recognizers = {};
	}

	public disconnect() {
		this._detach();

		if (this.target) {
			this.target.off('loaded', this._onTargetLoaded);
			this.target.off('unloaded', this._onTargetUnloaded);

			this._onTargetLoaded = null;
			this._onTargetUnloaded = null;
		}
		// clears target, context and callback references
		super.disconnect();
	}

	private _createRecognizer(type: GestureTypes, callback?: (args: GestureEventData) => void, swipeDirection?: UISwipeGestureRecognizerDirection): UIGestureRecognizer {
		let name = toString(type);
		const recognizerType = _getUIGestureRecognizerType(type);
		if (!recognizerType) {
			return;
		}

		const target = _createUIGestureRecognizerTarget(this, type, callback, this.context);
		const recognizer = recognizerType.alloc().initWithTargetAction(target, 'recognize');

		if (type === GestureTypes.swipe && swipeDirection) {
			name = `${name}${swipeDirection}`;
			(<UISwipeGestureRecognizer>recognizer).direction = swipeDirection;
		} else if (type === GestureTypes.touch) {
			(<TouchGestureRecognizer>recognizer).observer = this;
		} else if (type === GestureTypes.doubleTap) {
			(<UITapGestureRecognizer>recognizer).numberOfTapsRequired = 2;
		}

		recognizer.delegate = recognizerDelegateInstance;
		this._recognizers[name] = { recognizer, target };

		this.target.notify({
			eventName: GestureEvents.gestureAttached,
			object: this.target,
			type,
			view: this.target,
			ios: recognizer,
		});

		return recognizer;
	}
}

function _createUIGestureRecognizerTarget(owner: GesturesObserver, type: GestureTypes, callback?: (args: GestureEventData) => void, context?: any) {
	return UIGestureRecognizerImpl.initWithOwnerTypeCallback(new WeakRef(owner), type, callback, context);
}

interface RecognizerCache {
	recognizer: UIGestureRecognizer;
	target: UIGestureRecognizerImpl;
}

function _getUIGestureRecognizerType(type: GestureTypes) {
	let nativeType: typeof UIGestureRecognizer | null = null;

	if (type === GestureTypes.tap) {
		nativeType = UITapGestureRecognizer;
	} else if (type === GestureTypes.doubleTap) {
		nativeType = UITapGestureRecognizer;
	} else if (type === GestureTypes.pinch) {
		nativeType = UIPinchGestureRecognizer;
	} else if (type === GestureTypes.pan) {
		nativeType = UIPanGestureRecognizer;
	} else if (type === GestureTypes.swipe) {
		nativeType = UISwipeGestureRecognizer;
	} else if (type === GestureTypes.rotation) {
		nativeType = UIRotationGestureRecognizer;
	} else if (type === GestureTypes.longPress) {
		nativeType = UILongPressGestureRecognizer;
	} else if (type === GestureTypes.touch) {
		nativeType = TouchGestureRecognizer;
	}

	return nativeType;
}

function getState(recognizer: UIGestureRecognizer) {
	if (recognizer.state === UIGestureRecognizerState.Began) {
		return GestureStateTypes.began;
	} else if (recognizer.state === UIGestureRecognizerState.Cancelled || recognizer.state === UIGestureRecognizerState.Failed) {
		return GestureStateTypes.cancelled;
	} else if (recognizer.state === UIGestureRecognizerState.Changed) {
		return GestureStateTypes.changed;
	} else if (recognizer.state === UIGestureRecognizerState.Ended) {
		return GestureStateTypes.ended;
	}
}

function _getSwipeDirection(direction: UISwipeGestureRecognizerDirection): SwipeDirection {
	if (direction === UISwipeGestureRecognizerDirection.Down) {
		return SwipeDirection.down;
	} else if (direction === UISwipeGestureRecognizerDirection.Left) {
		return SwipeDirection.left;
	} else if (direction === UISwipeGestureRecognizerDirection.Right) {
		return SwipeDirection.right;
	} else if (direction === UISwipeGestureRecognizerDirection.Up) {
		return SwipeDirection.up;
	}
}

function _getTapData(args: GestureEventData): TapGestureEventData {
	const recognizer = <UITapGestureRecognizer>args.ios;
	const center = recognizer.locationInView(args.view.nativeViewProtected);

	return <TapGestureEventData>{
		type: args.type,
		view: args.view,
		ios: args.ios,
		android: undefined,
		eventName: args.eventName,
		object: args.object,
		getPointerCount: () => recognizer.numberOfTouches,
		getX: () => center.x,
		getY: () => center.y,
	};
}

function _getPinchData(args: GestureEventData): PinchGestureEventData {
	const recognizer = <UIPinchGestureRecognizer>args.ios;
	const center = recognizer.locationInView(args.view.nativeViewProtected);

	return <PinchGestureEventData>{
		type: args.type,
		view: args.view,
		ios: args.ios,
		android: undefined,
		scale: recognizer.scale,
		getFocusX: () => center.x,
		getFocusY: () => center.y,
		object: args.view,
		eventName: toString(args.type),
		state: getState(recognizer),
	};
}

function _getSwipeData(args: GestureEventData): SwipeGestureEventData {
	const recognizer = <UISwipeGestureRecognizer>args.ios;

	return <SwipeGestureEventData>{
		type: args.type,
		view: args.view,
		ios: args.ios,
		android: undefined,
		direction: _getSwipeDirection(recognizer.direction),
		object: args.view,
		eventName: toString(args.type),
	};
}

function _getPanData(args: GestureEventData, view: UIView): PanGestureEventData {
	const recognizer = <UIPanGestureRecognizer>args.ios;

	return <PanGestureEventData>{
		type: args.type,
		view: args.view,
		ios: args.ios,
		android: undefined,
		deltaX: recognizer.translationInView(view).x,
		deltaY: recognizer.translationInView(view).y,
		object: args.view,
		eventName: toString(args.type),
		state: getState(recognizer),
	};
}

function _getRotationData(args: GestureEventData): RotationGestureEventData {
	const recognizer = <UIRotationGestureRecognizer>args.ios;

	return <RotationGestureEventData>{
		type: args.type,
		view: args.view,
		ios: args.ios,
		android: undefined,
		rotation: recognizer.rotation * (180.0 / Math.PI),
		object: args.view,
		eventName: toString(args.type),
		state: getState(recognizer),
	};
}

function _getLongPressData(args: GestureEventData): GestureEventDataWithState {
	const recognizer = <UILongPressGestureRecognizer>args.ios;

	return <GestureEventDataWithState>{
		type: args.type,
		view: args.view,
		ios: args.ios,
		android: undefined,
		object: args.view,
		eventName: toString(args.type),
		state: getState(recognizer),
	};
}

@NativeClass
class TouchGestureRecognizer extends UIGestureRecognizer {
	public observer: GesturesObserver;
	private _eventData: TouchGestureEventData;

	touchesBeganWithEvent(touches: NSSet<any>, event: any): void {
		this.executeCallback(TouchAction.down, touches, event);
		this.view?.touchesBeganWithEvent(touches, event);
	}

	touchesMovedWithEvent(touches: NSSet<any>, event: any): void {
		this.executeCallback(TouchAction.move, touches, event);
		this.view?.touchesMovedWithEvent(touches, event);
	}

	touchesEndedWithEvent(touches: NSSet<any>, event: any): void {
		this.executeCallback(TouchAction.up, touches, event);
		this.view?.touchesEndedWithEvent(touches, event);
	}

	touchesCancelledWithEvent(touches: NSSet<any>, event: any): void {
		this.executeCallback(TouchAction.cancel, touches, event);
		this.view?.touchesCancelledWithEvent(touches, event);
	}

	private executeCallback(action: string, touches: NSSet<any>, event: any): void {
		if (!this._eventData) {
			this._eventData = new TouchGestureEventData();
		}

		this._eventData.prepare(this.observer.target, action, touches, event);
		this.observer.callback?.(this._eventData);
	}
}

class Pointer {
	public android: any = undefined;
	public ios: UITouch = undefined;

	private _view: View;

	private _location: CGPoint;

	private get location(): CGPoint {
		if (!this._location) {
			this._location = this.ios.locationInView(this._view.nativeViewProtected);
		}

		return this._location;
	}

	constructor(touch: UITouch, targetView: View) {
		this.ios = touch;
		this._view = targetView;
	}

	getX(): number {
		return this.location.x;
	}

	getY(): number {
		return this.location.y;
	}
}

class TouchGestureEventData {
	eventName: string = toString(GestureTypes.touch);
	type: GestureTypes = GestureTypes.touch;
	android: any = undefined;
	action: string;
	view: View;
	ios: { touches: NSSet<any>; event: _UIEvent };
	object: any;

	private _activePointers: Array<Pointer>;
	private _allPointers: Array<Pointer>;
	private _mainPointer: UITouch;

	public prepare(view: View, action: string, touches: NSSet<any>, event: _UIEvent) {
		this.action = action;
		this.view = view;
		this.object = view;
		this.ios = {
			touches: touches,
			event: event,
		};

		this._mainPointer = undefined;
		this._activePointers = undefined;
		this._allPointers = undefined;
	}

	getPointerCount(): number {
		return this.ios.event.allTouches.count;
	}

	private getMainPointer(): UITouch {
		if (this._mainPointer === undefined) {
			this._mainPointer = this.ios.touches.anyObject();
		}

		return this._mainPointer;
	}

	getActivePointers(): Array<Pointer> {
		if (!this._activePointers) {
			this._activePointers = [];

			for (let i = 0, nsArr = this.ios.touches.allObjects; i < nsArr.count; i++) {
				this._activePointers.push(new Pointer(nsArr.objectAtIndex(i), this.view));
			}
		}

		return this._activePointers;
	}

	getAllPointers(): Array<Pointer> {
		if (!this._allPointers) {
			this._allPointers = [];

			const nsArr = this.ios.event.allTouches.allObjects;
			for (let i = 0; i < nsArr.count; i++) {
				this._allPointers.push(new Pointer(nsArr.objectAtIndex(i), this.view));
			}
		}

		return this._allPointers;
	}

	getX(): number {
		const offset = this.view.nativeViewProtected.contentOffset;
		const offsetX = offset ? offset.x : 0;
		return this.getMainPointer().locationInView(this.view.nativeViewProtected).x - offsetX;
	}

	getY(): number {
		const offset = this.view.nativeViewProtected.contentOffset;
		const offsetY = offset ? offset.y : 0;
		return this.getMainPointer().locationInView(this.view.nativeViewProtected).y - offsetY;
	}
}
