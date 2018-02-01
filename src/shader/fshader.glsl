precision mediump float;

#define PI       3.1415926535897932384626433832795
#define TWO_PI   6.283185307179586476925286766559
#define HALF_PI  1.5707963267948966192313216916398

#define CAMERA_PROJECTION_TYPE_LINEAR        1
#define CAMERA_PROJECTION_TYPE_CYNLINDRICAL  2
#define CAMERA_PROJECTION_TYPE_PLANET        3
#define CAMERA_PROJECTION_TYPE_PANNINI       4

#define TEXTURE_PROJECTION_TYPE_EQUIPRECTANGLULAR 1
#define TEXTURE_PROJECTION_TYPE_FISHEYE           2

uniform sampler2D u_Sampler;

uniform float u_CamGeoWidth;
uniform float u_CamGeoHeight;

uniform float u_CamPOVLongitude;
uniform float u_CamPOVLatitude;
uniform float u_CamZoom;

uniform int u_CamProjType;
uniform int u_TexProjType;

varying vec4 v_Pos;

float theta = 0.0;
float phi = 0.0;

void cam_proj_linear(float x, float y, float z) {
	theta = atan(z / x);

	if (x<0.0) {
		theta = PI + theta;
	} else if (x>0.0 && z<0.0) {
		theta = TWO_PI + theta;
	}

	phi = atan(y / sqrt(x * x + z * z)) + HALF_PI;
}

void cam_proj_cylindrical(float x, float y, float z) {
	y = y * u_CamZoom;
	z = z * u_CamZoom;

	theta = z * TWO_PI - u_CamPOVLongitude / 2.0;
	phi = atan(y) + HALF_PI;
}

void cam_proj_planet(float x, float y, float z) {
	y = y * u_CamZoom;
	z = z * u_CamZoom;

	z = -z;

	float m = 1.0 + z * z + y * y;

	float P = (2.0 * z) / m;
	float Q = (2.0 * y) / m;
	float R = (m - 2.0) / m;

	theta = atan(P/Q);

	if (Q<0.0) {
		theta = PI + theta;
	} else if (Q>0.0 && P<0.0) {
		theta = TWO_PI + theta;
	}

	theta -= u_CamPOVLongitude / 2.0;
	phi = atan(R / sqrt(P * P + Q * Q)) + HALF_PI;
}

void cam_proj_pannini(float x, float y, float z) {
	y = y * u_CamZoom;
	z = z * u_CamZoom;

	theta = 2.0 * atan(z * 0.5 / x);

	if (x<0.0) {
		theta = PI + theta;
	} else if (x>0.0 && z<0.0) {
		theta = TWO_PI + theta;
	}

	theta -= u_CamPOVLongitude / 2.0;

	phi = atan(y / sqrt(x * x + z * z)) + HALF_PI;
}

void cam_proj(float x, float y, float z) {
	if (u_CamProjType == CAMERA_PROJECTION_TYPE_CYNLINDRICAL) {
		cam_proj_cylindrical(x, y, z);
	} else if (u_CamProjType == CAMERA_PROJECTION_TYPE_PLANET) {
		cam_proj_planet(x, y, z);
	} else if (u_CamProjType == CAMERA_PROJECTION_TYPE_PANNINI) {
    cam_proj_pannini(x, y, z);
	} else {
		cam_proj_linear(x, y, z);
	}
}

vec2 tex_proj_equiprectangular() {
	return vec2(theta/TWO_PI, phi/PI);
}

vec2 tex_proj_fisheye() {
	// todo
	return vec2(0.0, 0.0);
}

vec2 tex_proj() {
	if (u_TexProjType == TEXTURE_PROJECTION_TYPE_EQUIPRECTANGLULAR) {
		return tex_proj_equiprectangular();
	} else {
		return tex_proj_fisheye();
	}
}

void main() {
	float x = v_Pos.x;
	float y = v_Pos.y;
	float z = v_Pos.z;

	cam_proj(x, y, z);

	gl_FragColor = texture2D(u_Sampler, tex_proj());
}