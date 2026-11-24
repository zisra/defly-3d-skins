async function showSkinPreview(id, previewOptions) {
	const modalContent = document.querySelector('#modal-content');
	const colorSelect = document.querySelector('#color-select');
	const idleSelect = document.querySelector('#idle-select');
	const skinDownloadButton = document.querySelector('#skin-download');
	const skinImageDownloadButton = document.querySelector('#download-image');
	const freezeImageButton = document.querySelector('#freeze-image');
	const previewButtons = document.querySelector('#preview-buttons');

	const TINT = previewOptions?.color ?? '3d5dff';
	const BACKGROUND_COLOR = previewOptions?.containerColor ?? 0xffffff;
	const RESOLUTION = previewOptions?.containerSize || 400;
	const SPRITE_SIZE = previewOptions?.size || 256;
	const IDLE = previewOptions?.idle === true;
	const ANIMATED = previewOptions?.animated === false;

	const RECORDING_BPS = previewOptions?.bitsPerSecond || 4500000;
	const RECORDING_LENGTH = previewOptions?.recordingLength || 5000;

	previewButtons.classList.remove('invisible');

	app = new Application({
		width: RESOLUTION,
		height: RESOLUTION,
		backgroundAlpha: BACKGROUND_COLOR === 0xffffff ? 0 : 1,
		background: BACKGROUND_COLOR,
		hello: false,
		resolution: 1,
		antialias: true,
	});

	modalContent.appendChild(app.view);

	if (!skin || savedSkinId !== id) {
		const data = await fetch(`skin/${id}`);
		skin = await data.json();
		savedSkinId = id;
	}

	if (skin.images[skin.spec.base]) {
		const baseTexture = Texture.from(skin.images[skin.spec.base]);
		const baseSprite = new Sprite(baseTexture);
		baseSprite.width = SPRITE_SIZE;
		baseSprite.height = SPRITE_SIZE;
		baseSprite.tint = TINT;
		baseSprite.anchor.set(0.5);
		baseSprite.position.set(RESOLUTION / 2, RESOLUTION / 2);
		app.stage.addChild(baseSprite);
	}

	if (skin.images[skin.spec.notint]) {
		const notintTexture = Texture.from(skin.images[skin.spec.notint]);
		const notintSprite = new Sprite(notintTexture);
		notintSprite.width = SPRITE_SIZE;
		notintSprite.height = SPRITE_SIZE;
		notintSprite.anchor.set(0.5);
		notintSprite.position.set(RESOLUTION / 2, RESOLUTION / 2);
		app.stage.addChild(notintSprite);
	}

	skin.spec.rotors
		.filter((rotor) => {
			if (rotor.visibility === '0') return true;
			if (!IDLE) {
				if (rotor.visibility === '1') return true;
				if (rotor.visibility === '2') return false;
				return true;
			} else {
				if (rotor.visibility === '1') return false;
				if (rotor.visibility === '2') return true;
				return true;
			}
		})
		.forEach((rotor) => {
			const rotorTexture = Texture.from(skin.images[rotor.img]);
			const rotorSprite = new Sprite(rotorTexture);

			const x = (rotor.x / 2) * SPRITE_SIZE + RESOLUTION / 2;
			const y = (rotor.y / 2) * SPRITE_SIZE + RESOLUTION / 2;

			rotorSprite.anchor.set(0.5);

			const rotorSize = rotor.size * SPRITE_SIZE;
			rotorSprite.width = rotorSprite.height = rotorSize;

			rotorSprite.position.set(x, y);

			if (rotor.tinted) {
				rotorSprite.tint = TINT;
			}

			if (rotor.layer <= app.stage.children.length) {
				app.stage.addChildAt(rotorSprite, rotor.layer);
			} else {
				app.stage.addChild(rotorSprite);
			}

			if (!rotor.noRotation && !ANIMATED) {
				const rotationSpeedRad = DEG_TO_RAD * -rotor.speed;

				app.ticker.add(() => {
					rotorSprite.rotation += rotationSpeedRad;
				});
			}
		});

	app.stage.sortChildren();

	skinDownloadButton.innerText = 'Record';
	skinDownloadButton.onclick = () => {
		skinDownloadButton.disabled = true;
		skinDownloadButton.innerText = 'Recording...';
		const canvas = document.querySelector('canvas');
		const recorder = new CanvasRecorder(canvas, RECORDING_BPS);
		recorder.start();

		setTimeout(
			() => {
				recorder.stop();
				skinDownloadButton.disabled = false;
				skinDownloadButton.innerText = 'Download';
			},
			parseFloat(
				prompt('How many seconds should the recording be? No response = 4secs'),
			) * 1000 || RECORDING_LENGTH,
		);

		skinDownloadButton.onclick = () => {
			recorder.save(`skin_${id}.webm`);
		};
	};

	colorSelect.onchange = () => {
		app.destroy(true, { children: true });

		showSkinPreview(id, {
			color: colorSelect.value,
			idle: idleSelect.value === 'idle',
		});
	};
	idleSelect.onchange = () => {
		app.destroy(true, { children: true });

		showSkinPreview(id, {
			color: colorSelect.value,
			idle: idleSelect.value === 'idle',
		});
	};

	skinImageDownloadButton.onclick = () => {
		const canvas = app.view;
		requestAnimationFrame(() => {
			const link = document.createElement('a');
			link.download = `skin_${id}.png`;
			link.href = canvas.toDataURL('image/png');
			link.click();
		});
	};

	freezeImageButton.onclick = () => {
		app.destroy(true, { children: true });

		showSkinPreview(id, {
			color: colorSelect.value,
			idle: idleSelect.value === 'idle',
			animated: false,
		});
	};
}
